'use strict';

const { Pool } = require('pg');
const logger   = require('../utils/logger');

let pool;

async function init(databaseUrl) {
  pool = new Pool({
    connectionString: databaseUrl,
    ssl: { rejectUnauthorized: false },
  });

  await pool.query('SELECT 1');

  await pool.query(`
    -- One row per join event (current + historical). left_at IS NULL => still in server.
    CREATE TABLE IF NOT EXISTS invite_joins (
      id          SERIAL PRIMARY KEY,
      guild_id    TEXT        NOT NULL,
      user_id     TEXT        NOT NULL,
      inviter_id  TEXT,                 -- NULL for vanity / unknown
      invite_code TEXT        NOT NULL DEFAULT 'unknown',
      source      TEXT        NOT NULL DEFAULT 'normal',  -- normal | vanity | unknown
      fake        BOOLEAN     NOT NULL DEFAULT FALSE,
      left_at     TIMESTAMPTZ,
      joined_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_invite_joins_inviter ON invite_joins(guild_id, inviter_id);
    CREATE INDEX IF NOT EXISTS idx_invite_joins_user    ON invite_joins(guild_id, user_id);
    CREATE INDEX IF NOT EXISTS idx_invite_joins_time    ON invite_joins(guild_id, joined_at);

    -- Manual bonus invites granted to a user.
    CREATE TABLE IF NOT EXISTS invite_bonus (
      guild_id TEXT    NOT NULL,
      user_id  TEXT    NOT NULL,
      amount   INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (guild_id, user_id)
    );

    -- Persisted invite use-count cache (so attribution survives restarts).
    CREATE TABLE IF NOT EXISTS invite_cache (
      guild_id   TEXT    NOT NULL,
      code       TEXT    NOT NULL,
      inviter_id TEXT,
      uses       INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (guild_id, code)
    );

    -- Per-guild config blob (log channel, fake threshold, reward roles, …).
    CREATE TABLE IF NOT EXISTS invite_guild_config (
      guild_id TEXT PRIMARY KEY,
      value    JSONB NOT NULL
    );

    -- A self-refreshing leaderboard message that the bot keeps pinned & updated.
    CREATE TABLE IF NOT EXISTS invite_smart_leaderboard (
      guild_id   TEXT PRIMARY KEY,
      channel_id TEXT NOT NULL,
      message_id TEXT NOT NULL
    );

    -- Users / roles excluded from the leaderboard + smart leaderboard.
    CREATE TABLE IF NOT EXISTS invite_leaderboard_hidden (
      guild_id  TEXT NOT NULL,
      kind      TEXT NOT NULL,   -- 'user' | 'role'
      target_id TEXT NOT NULL,
      PRIMARY KEY (guild_id, kind, target_id)
    );

    -- Bot-created "personal" invites: maps a code to the player who requested it,
    -- so joins through it are credited to the player (not the bot that made it).
    CREATE TABLE IF NOT EXISTS invite_personal_links (
      guild_id    TEXT        NOT NULL,
      invite_code TEXT        NOT NULL,
      user_id     TEXT        NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (guild_id, invite_code)
    );
    CREATE INDEX IF NOT EXISTS idx_invite_personal_user ON invite_personal_links(guild_id, user_id);

    -- Invite codes bound to a channel: joins via the code are logged there.
    CREATE TABLE IF NOT EXISTS invite_tracked_links (
      guild_id    TEXT        NOT NULL,
      invite_code TEXT        NOT NULL,
      channel_id  TEXT        NOT NULL,
      label       TEXT,
      created_by  TEXT,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (guild_id, invite_code)
    );

    -- Invite-gated giveaways. Eligibility is computed live from invite_joins
    -- (real invites since created_at), so it always survives restarts and resets
    -- automatically each time a new giveaway is started.
    CREATE TABLE IF NOT EXISTS invite_giveaways (
      id               SERIAL      PRIMARY KEY,
      guild_id         TEXT        NOT NULL,
      channel_id       TEXT        NOT NULL,
      message_id       TEXT,
      prize            TEXT        NOT NULL,
      required_invites INTEGER     NOT NULL DEFAULT 1,
      status           TEXT        NOT NULL DEFAULT 'active',  -- active | ended | cancelled
      winner_id        TEXT,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      ends_at          TIMESTAMPTZ NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_invite_giveaways_active ON invite_giveaways(guild_id, status, ends_at);

    -- Frozen giveaway entries: one row written when a member first crosses the
    -- invite threshold, so participation is stored (not recomputed) and survives
    -- restarts. Once entered, a later leave by an invitee doesn't remove them.
    CREATE TABLE IF NOT EXISTS invite_giveaway_entries (
      giveaway_id      INTEGER     NOT NULL REFERENCES invite_giveaways(id) ON DELETE CASCADE,
      user_id          TEXT        NOT NULL,
      invites_at_entry INTEGER     NOT NULL,
      entered_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (giveaway_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_invite_giveaway_entries ON invite_giveaway_entries(giveaway_id);

    -- Web panel sessions (own table, prefixed like the rest).
    CREATE TABLE IF NOT EXISTS invite_web_sessions (
      sid    TEXT        PRIMARY KEY,
      sess   JSONB       NOT NULL,
      expire TIMESTAMPTZ NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_invite_web_sessions_expire ON invite_web_sessions(expire);
  `);

  logger.info('Storage: PostgreSQL connected and schema ready');
}

async function ping() { await pool.query('SELECT 1'); }

// ── Invite cache ────────────────────────────────────────────────────────────────
async function getCachedInvites(guildId) {
  const r = await pool.query('SELECT code, inviter_id, uses FROM invite_cache WHERE guild_id = $1', [guildId]);
  return r.rows;
}

async function replaceCache(guildId, entries) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM invite_cache WHERE guild_id = $1', [guildId]);
    for (const e of entries) {
      await client.query(
        'INSERT INTO invite_cache (guild_id, code, inviter_id, uses) VALUES ($1, $2, $3, $4) ON CONFLICT (guild_id, code) DO UPDATE SET inviter_id = EXCLUDED.inviter_id, uses = EXCLUDED.uses',
        [guildId, e.code, e.inviterId ?? null, e.uses ?? 0],
      );
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

// ── Joins / leaves ──────────────────────────────────────────────────────────────
async function recordJoin({ guildId, userId, inviterId, code, source, fake }) {
  await pool.query(
    `INSERT INTO invite_joins (guild_id, user_id, inviter_id, invite_code, source, fake)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [guildId, userId, inviterId ?? null, code ?? 'unknown', source ?? 'normal', !!fake],
  );
}

async function hasPriorJoin(guildId, userId) {
  const r = await pool.query('SELECT 1 FROM invite_joins WHERE guild_id = $1 AND user_id = $2 LIMIT 1', [guildId, userId]);
  return r.rows.length > 0;
}

// How many times this user has joined / left this guild (all-time, from our records).
async function getUserJoinSummary(guildId, userId) {
  const r = await pool.query(
    `SELECT COUNT(*) AS joins,
            COUNT(*) FILTER (WHERE left_at IS NOT NULL) AS leaves,
            MIN(joined_at) AS first_join
     FROM invite_joins WHERE guild_id = $1 AND user_id = $2`,
    [guildId, userId],
  );
  const row = r.rows[0] || {};
  return {
    joins:     parseInt(row.joins ?? 0, 10),
    leaves:    parseInt(row.leaves ?? 0, 10),
    firstJoin: row.first_join ?? null,
  };
}

// Mark the active join(s) for a leaving member as left. Returns the inviter_id.
async function markLeft(guildId, userId) {
  const r = await pool.query(
    `UPDATE invite_joins SET left_at = NOW()
     WHERE guild_id = $1 AND user_id = $2 AND left_at IS NULL
     RETURNING inviter_id`,
    [guildId, userId],
  );
  return r.rows[0]?.inviter_id ?? null;
}

async function getInvitedBy(guildId, userId) {
  const r = await pool.query(
    `SELECT inviter_id, invite_code, source, fake, left_at, joined_at
     FROM invite_joins WHERE guild_id = $1 AND user_id = $2
     ORDER BY joined_at DESC LIMIT 1`,
    [guildId, userId],
  );
  return r.rows[0] ?? null;
}

// Manual correction: rewrite a member's most-recent join to a REAL invite for a
// given inviter (so it counts as ✅ regular, not a 🎁 bonus). Returns whether a
// row was updated, the previous inviter (to re-sync their rewards too), and
// whether that join is currently left.
async function reassignJoin(guildId, userId, inviterId, code) {
  const r = await pool.query(
    `WITH target AS (
       SELECT id, inviter_id AS old_inviter, left_at
       FROM invite_joins
       WHERE guild_id = $1 AND user_id = $2
       ORDER BY joined_at DESC
       LIMIT 1
     )
     UPDATE invite_joins j
     SET inviter_id = $3, invite_code = $4, source = 'normal', fake = FALSE
     FROM target
     WHERE j.id = target.id
     RETURNING target.old_inviter AS old_inviter, target.left_at AS left_at`,
    [guildId, userId, inviterId, code ?? 'manual'],
  );
  const row = r.rows[0];
  return { updated: !!row, oldInviter: row?.old_inviter ?? null, left: !!row?.left_at };
}

async function getInvitedList(guildId, inviterId, limit = 50) {
  const r = await pool.query(
    `SELECT user_id, fake, left_at, joined_at
     FROM invite_joins WHERE guild_id = $1 AND inviter_id = $2
     ORDER BY joined_at DESC LIMIT $3`,
    [guildId, inviterId, limit],
  );
  return r.rows;
}

// ── Bonus ───────────────────────────────────────────────────────────────────────
async function getBonus(guildId, userId) {
  const r = await pool.query('SELECT amount FROM invite_bonus WHERE guild_id = $1 AND user_id = $2', [guildId, userId]);
  return r.rows[0]?.amount ?? 0;
}

async function addBonus(guildId, userId, delta) {
  const r = await pool.query(
    `INSERT INTO invite_bonus (guild_id, user_id, amount) VALUES ($1, $2, $3)
     ON CONFLICT (guild_id, user_id) DO UPDATE SET amount = invite_bonus.amount + EXCLUDED.amount
     RETURNING amount`,
    [guildId, userId, delta],
  );
  return r.rows[0].amount;
}

// ── Stats ─────────────────────────────────────────────────────────────────────
async function getInviterStats(guildId, inviterId) {
  const [counts, bonus] = await Promise.all([
    pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE NOT fake AND left_at IS NULL)     AS regular,
         COUNT(*) FILTER (WHERE NOT fake AND left_at IS NOT NULL) AS leaves,
         COUNT(*) FILTER (WHERE fake)                              AS fake
       FROM invite_joins WHERE guild_id = $1 AND inviter_id = $2`,
      [guildId, inviterId],
    ),
    getBonus(guildId, inviterId),
  ]);
  const c = counts.rows[0] || {};
  const regular = parseInt(c.regular ?? 0, 10);
  const leaves  = parseInt(c.leaves ?? 0, 10);
  const fake    = parseInt(c.fake ?? 0, 10);
  return { regular, leaves, fake, bonus, total: regular + bonus };
}

async function getLeaderboard(guildId, limit = 10, excludeUserIds = []) {
  const exclude = excludeUserIds.length ? excludeUserIds : null;
  const r = await pool.query(
    `SELECT j.inviter_id,
       COUNT(*) FILTER (WHERE NOT j.fake AND j.left_at IS NULL)     AS regular,
       COUNT(*) FILTER (WHERE NOT j.fake AND j.left_at IS NOT NULL) AS leaves,
       COUNT(*) FILTER (WHERE j.fake)                                AS fake,
       COALESCE(b.amount, 0)                                         AS bonus
     FROM invite_joins j
     LEFT JOIN invite_bonus b ON b.guild_id = j.guild_id AND b.user_id = j.inviter_id
     WHERE j.guild_id = $1 AND j.inviter_id IS NOT NULL
       AND ($3::text[] IS NULL OR j.inviter_id <> ALL($3))
     GROUP BY j.inviter_id, b.amount
     ORDER BY (COUNT(*) FILTER (WHERE NOT j.fake AND j.left_at IS NULL) + COALESCE(b.amount, 0)) DESC,
              regular DESC
     LIMIT $2`,
    [guildId, limit, exclude],
  );
  return r.rows.map(row => {
    const regular = parseInt(row.regular, 10);
    const bonus   = parseInt(row.bonus, 10);
    return {
      inviterId: row.inviter_id,
      regular,
      leaves: parseInt(row.leaves, 10),
      fake:   parseInt(row.fake, 10),
      bonus,
      total:  regular + bonus,
    };
  });
}

async function getOverview(guildId) {
  const r = await pool.query(
    `SELECT
       COUNT(*)                                                  AS total_joins,
       COUNT(*) FILTER (WHERE left_at IS NULL AND NOT fake)      AS active,
       COUNT(*) FILTER (WHERE left_at IS NOT NULL)               AS left_total,
       COUNT(*) FILTER (WHERE fake)                              AS fake_total,
       COUNT(DISTINCT inviter_id) FILTER (WHERE inviter_id IS NOT NULL) AS inviters
     FROM invite_joins WHERE guild_id = $1`,
    [guildId],
  );
  const row = r.rows[0] || {};
  return {
    totalJoins: parseInt(row.total_joins ?? 0, 10),
    active:     parseInt(row.active ?? 0, 10),
    leftTotal:  parseInt(row.left_total ?? 0, 10),
    fakeTotal:  parseInt(row.fake_total ?? 0, 10),
    inviters:   parseInt(row.inviters ?? 0, 10),
  };
}

async function getRecentJoins(guildId, limit = 50) {
  const r = await pool.query(
    `SELECT user_id, inviter_id, invite_code, source, fake, left_at, joined_at
     FROM invite_joins WHERE guild_id = $1
     ORDER BY joined_at DESC LIMIT $2`,
    [guildId, limit],
  );
  return r.rows;
}

// ── Guild config ────────────────────────────────────────────────────────────────
async function getGuildConfig(guildId) {
  const r = await pool.query('SELECT value FROM invite_guild_config WHERE guild_id = $1', [guildId]);
  return r.rows[0]?.value ?? null;
}

async function saveGuildConfig(guildId, value) {
  await pool.query(
    `INSERT INTO invite_guild_config (guild_id, value) VALUES ($1, $2)
     ON CONFLICT (guild_id) DO UPDATE SET value = EXCLUDED.value`,
    [guildId, JSON.stringify(value)],
  );
}

// ── Smart (pinned, self-refreshing) leaderboard ──────────────────────────────────
async function getSmartLeaderboard(guildId) {
  const r = await pool.query('SELECT channel_id, message_id FROM invite_smart_leaderboard WHERE guild_id = $1', [guildId]);
  return r.rows[0] ?? null;
}

async function saveSmartLeaderboard(guildId, channelId, messageId) {
  await pool.query(
    `INSERT INTO invite_smart_leaderboard (guild_id, channel_id, message_id) VALUES ($1, $2, $3)
     ON CONFLICT (guild_id) DO UPDATE SET channel_id = EXCLUDED.channel_id, message_id = EXCLUDED.message_id`,
    [guildId, channelId, messageId],
  );
}

async function deleteSmartLeaderboard(guildId) {
  await pool.query('DELETE FROM invite_smart_leaderboard WHERE guild_id = $1', [guildId]);
}

// ── Leaderboard hidden list (users / roles) ──────────────────────────────────────
async function addHidden(guildId, kind, targetId) {
  await pool.query(
    `INSERT INTO invite_leaderboard_hidden (guild_id, kind, target_id) VALUES ($1, $2, $3)
     ON CONFLICT (guild_id, kind, target_id) DO NOTHING`,
    [guildId, kind, targetId],
  );
}

async function removeHidden(guildId, kind, targetId) {
  const r = await pool.query(
    'DELETE FROM invite_leaderboard_hidden WHERE guild_id = $1 AND kind = $2 AND target_id = $3',
    [guildId, kind, targetId],
  );
  return r.rowCount > 0;
}

async function getHidden(guildId) {
  const r = await pool.query('SELECT kind, target_id FROM invite_leaderboard_hidden WHERE guild_id = $1', [guildId]);
  const users = [], roles = [];
  for (const row of r.rows) (row.kind === 'role' ? roles : users).push(row.target_id);
  return { users, roles };
}

// ── Personal invites (bot-created code → requesting player) ───────────────────────
async function addPersonalInvite(guildId, code, userId) {
  await pool.query(
    `INSERT INTO invite_personal_links (guild_id, invite_code, user_id) VALUES ($1, $2, $3)
     ON CONFLICT (guild_id, invite_code) DO UPDATE SET user_id = EXCLUDED.user_id`,
    [guildId, code, userId],
  );
}

// The player's most recent personal invite code (so we reuse it instead of spamming new ones).
async function getPersonalInviteByUser(guildId, userId) {
  const r = await pool.query(
    'SELECT invite_code FROM invite_personal_links WHERE guild_id = $1 AND user_id = $2 ORDER BY created_at DESC LIMIT 1',
    [guildId, userId],
  );
  return r.rows[0]?.invite_code ?? null;
}

// Which player owns a given code (used to re-attribute joins away from the bot).
async function getPersonalInviteOwner(guildId, code) {
  const r = await pool.query(
    'SELECT user_id FROM invite_personal_links WHERE guild_id = $1 AND invite_code = $2',
    [guildId, code],
  );
  return r.rows[0]?.user_id ?? null;
}

async function deletePersonalInvite(guildId, code) {
  await pool.query('DELETE FROM invite_personal_links WHERE guild_id = $1 AND invite_code = $2', [guildId, code]);
}

// Every custom (personal) link for a guild, with its owner and how many joins
// came through it — powers the web panel's "who does this link belong to" view.
async function listPersonalLinks(guildId) {
  const r = await pool.query(
    `SELECT p.invite_code, p.user_id, p.created_at,
            COUNT(j.id)                                                AS total,
            COUNT(j.id) FILTER (WHERE j.left_at IS NULL AND NOT j.fake) AS active
       FROM invite_personal_links p
       LEFT JOIN invite_joins j
         ON j.guild_id = p.guild_id AND j.invite_code = p.invite_code
      WHERE p.guild_id = $1
      GROUP BY p.invite_code, p.user_id, p.created_at
      ORDER BY total DESC, p.created_at DESC`,
    [guildId],
  );
  return r.rows.map(row => ({
    code:      row.invite_code,
    userId:    row.user_id,
    createdAt: row.created_at,
    total:     parseInt(row.total, 10),
    active:    parseInt(row.active, 10),
  }));
}

// ── Tracked links (invite code → channel) ────────────────────────────────────────
async function addTrackedLink(guildId, code, channelId, label, createdBy) {
  await pool.query(
    `INSERT INTO invite_tracked_links (guild_id, invite_code, channel_id, label, created_by) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (guild_id, invite_code) DO UPDATE SET channel_id = EXCLUDED.channel_id, label = EXCLUDED.label, created_by = EXCLUDED.created_by`,
    [guildId, code, channelId, label ?? null, createdBy ?? null],
  );
}

async function removeTrackedLink(guildId, code) {
  const r = await pool.query('DELETE FROM invite_tracked_links WHERE guild_id = $1 AND invite_code = $2', [guildId, code]);
  return r.rowCount > 0;
}

async function getTrackedLink(guildId, code) {
  const r = await pool.query(
    'SELECT invite_code, channel_id, label, created_by FROM invite_tracked_links WHERE guild_id = $1 AND invite_code = $2',
    [guildId, code],
  );
  return r.rows[0] ?? null;
}

async function listTrackedLinks(guildId) {
  const r = await pool.query(
    'SELECT invite_code, channel_id, label, created_by, created_at FROM invite_tracked_links WHERE guild_id = $1 ORDER BY created_at ASC',
    [guildId],
  );
  return r.rows;
}

// Join breakdown for a single invite code (used by tracked-link logs/listing).
async function getCodeJoinStats(guildId, code) {
  const r = await pool.query(
    `SELECT
       COUNT(*)                                              AS total,
       COUNT(*) FILTER (WHERE left_at IS NULL AND NOT fake)  AS active,
       COUNT(*) FILTER (WHERE left_at IS NOT NULL)           AS left,
       COUNT(*) FILTER (WHERE fake)                          AS fake
     FROM invite_joins WHERE guild_id = $1 AND invite_code = $2`,
    [guildId, code],
  );
  const row = r.rows[0] || {};
  return {
    total:  parseInt(row.total ?? 0, 10),
    active: parseInt(row.active ?? 0, 10),
    left:   parseInt(row.left ?? 0, 10),
    fake:   parseInt(row.fake ?? 0, 10),
  };
}

// ── Giveaways ─────────────────────────────────────────────────────────────────────
async function createGiveaway({ guildId, channelId, prize, requiredInvites, endsAt }) {
  const r = await pool.query(
    `INSERT INTO invite_giveaways (guild_id, channel_id, prize, required_invites, ends_at)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [guildId, channelId, prize, requiredInvites, endsAt],
  );
  return r.rows[0];
}

async function setGiveawayMessage(id, messageId) {
  await pool.query('UPDATE invite_giveaways SET message_id = $2 WHERE id = $1', [id, messageId]);
}

async function getGiveaway(guildId, id) {
  const r = await pool.query('SELECT * FROM invite_giveaways WHERE guild_id = $1 AND id = $2', [guildId, id]);
  return r.rows[0] ?? null;
}

async function getActiveGiveaways(guildId) {
  const r = await pool.query(
    "SELECT * FROM invite_giveaways WHERE guild_id = $1 AND status = 'active' ORDER BY ends_at ASC",
    [guildId],
  );
  return r.rows;
}

async function listGiveaways(guildId, limit = 10) {
  const r = await pool.query(
    'SELECT * FROM invite_giveaways WHERE guild_id = $1 ORDER BY created_at DESC LIMIT $2',
    [guildId, limit],
  );
  return r.rows;
}

// Flip an active row to ended (idempotent — only the first caller "wins" the race
// between the sweep and a manual /end). Returns true if this call ended it.
async function endGiveawayRow(id, winnerId) {
  const r = await pool.query(
    "UPDATE invite_giveaways SET status = 'ended', winner_id = $2 WHERE id = $1 AND status = 'active' RETURNING id",
    [id, winnerId ?? null],
  );
  return r.rowCount > 0;
}

async function setGiveawayWinner(id, winnerId) {
  await pool.query('UPDATE invite_giveaways SET winner_id = $2 WHERE id = $1', [id, winnerId ?? null]);
}

async function cancelGiveawayRow(guildId, id) {
  const r = await pool.query(
    "UPDATE invite_giveaways SET status = 'cancelled' WHERE guild_id = $1 AND id = $2 AND status = 'active' RETURNING id",
    [guildId, id],
  );
  return r.rowCount > 0;
}

// Freeze a participant into a giveaway. Idempotent — returns true only if this
// call created the entry (so we log/announce a new entrant exactly once).
async function addGiveawayEntry(giveawayId, userId, invitesAtEntry) {
  const r = await pool.query(
    `INSERT INTO invite_giveaway_entries (giveaway_id, user_id, invites_at_entry)
     VALUES ($1, $2, $3) ON CONFLICT (giveaway_id, user_id) DO NOTHING RETURNING user_id`,
    [giveawayId, userId, invitesAtEntry],
  );
  return r.rowCount > 0;
}

async function isGiveawayEntrant(giveawayId, userId) {
  const r = await pool.query(
    'SELECT 1 FROM invite_giveaway_entries WHERE giveaway_id = $1 AND user_id = $2',
    [giveawayId, userId],
  );
  return r.rows.length > 0;
}

async function countGiveawayEntries(giveawayId) {
  const r = await pool.query('SELECT COUNT(*)::int AS n FROM invite_giveaway_entries WHERE giveaway_id = $1', [giveawayId]);
  return r.rows[0]?.n ?? 0;
}

async function getGiveawayEntrants(giveawayId) {
  const r = await pool.query('SELECT user_id FROM invite_giveaway_entries WHERE giveaway_id = $1', [giveawayId]);
  return r.rows.map(row => row.user_id);
}

// One member's REAL, still-present invites gained since `since` (for the
// per-user "am I in this giveaway?" button).
async function countUserInvitesSince(guildId, userId, since) {
  const r = await pool.query(
    `SELECT COUNT(*)::int AS invites FROM invite_joins
      WHERE guild_id = $1 AND inviter_id = $2 AND joined_at >= $3 AND NOT fake AND left_at IS NULL`,
    [guildId, userId, since],
  );
  return r.rows[0]?.invites ?? 0;
}

// Inviters with >= `required` REAL, still-present invites gained since `since`.
// "New invites only" = the joined_at >= since bound; carried-over invites don't count.
async function getEligibleInviters(guildId, since, required) {
  const r = await pool.query(
    `SELECT inviter_id, COUNT(*)::int AS invites
       FROM invite_joins
      WHERE guild_id = $1 AND inviter_id IS NOT NULL
        AND joined_at >= $2 AND NOT fake AND left_at IS NULL
      GROUP BY inviter_id
      HAVING COUNT(*) >= $3
      ORDER BY invites DESC`,
    [guildId, since, required],
  );
  return r.rows.map(row => ({ inviterId: row.inviter_id, invites: row.invites }));
}

// ── Web sessions ────────────────────────────────────────────────────────────────
async function getSession(sid) {
  const r = await pool.query('SELECT sess FROM invite_web_sessions WHERE sid = $1 AND expire > NOW()', [sid]);
  return r.rows[0]?.sess ?? null;
}
async function setSession(sid, sess, expire) {
  await pool.query(
    `INSERT INTO invite_web_sessions (sid, sess, expire) VALUES ($1, $2, $3)
     ON CONFLICT (sid) DO UPDATE SET sess = EXCLUDED.sess, expire = EXCLUDED.expire`,
    [sid, JSON.stringify(sess), expire],
  );
}
async function destroySession(sid) { await pool.query('DELETE FROM invite_web_sessions WHERE sid = $1', [sid]); }
async function touchSession(sid, expire) { await pool.query('UPDATE invite_web_sessions SET expire = $2 WHERE sid = $1', [sid, expire]); }
async function cleanExpiredSessions() { await pool.query('DELETE FROM invite_web_sessions WHERE expire < NOW()'); }

module.exports = {
  init, ping,
  getCachedInvites, replaceCache,
  recordJoin, hasPriorJoin, getUserJoinSummary, markLeft, getInvitedBy, getInvitedList, reassignJoin,
  getBonus, addBonus,
  getInviterStats, getLeaderboard, getOverview, getRecentJoins,
  getSmartLeaderboard, saveSmartLeaderboard, deleteSmartLeaderboard,
  addHidden, removeHidden, getHidden,
  addPersonalInvite, getPersonalInviteByUser, getPersonalInviteOwner, deletePersonalInvite, listPersonalLinks,
  addTrackedLink, removeTrackedLink, getTrackedLink, listTrackedLinks, getCodeJoinStats,
  createGiveaway, setGiveawayMessage, getGiveaway, getActiveGiveaways, listGiveaways,
  endGiveawayRow, setGiveawayWinner, cancelGiveawayRow, getEligibleInviters, countUserInvitesSince,
  addGiveawayEntry, isGiveawayEntrant, countGiveawayEntries, getGiveawayEntrants,
  getGuildConfig, saveGuildConfig,
  getSession, setSession, destroySession, touchSession, cleanExpiredSessions,
};
