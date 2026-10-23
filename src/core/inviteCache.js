'use strict';

// Invite attribution engine.
//
// Discord has no "user X used invite Y" event, so we diff invite use-counts:
//   - keep an in-memory snapshot of every invite's `uses` (+ vanity uses)
//   - when a member joins, re-fetch and find the code whose uses went up
//     (or one that vanished because it hit max-uses) → that's the invite used
//
// Robustness:
//   - all snapshot reads/writes for a guild are serialized through a per-guild
//     lock, so concurrent joins (or a join racing an invite create/delete) can't
//     clobber each other's view.
//   - on a join we "consume" only ONE use from the matched code and leave any
//     other incremented codes pending, so a second join in the same burst can
//     still be attributed instead of falling through to "unknown".
//   - invite fetches are retried, since a transient API hiccup would otherwise
//     turn a perfectly normal join into "unknown".
//
// The snapshot is also persisted (storage.replaceCache) so it survives restarts.

const storage = require('./storage');
const logger  = require('../utils/logger');

// guildId -> { invites: Map(code -> { uses, inviterId }), vanityUses }
const cache = new Map();

// ── Per-guild lock ────────────────────────────────────────────────────────────
// Each guild gets a serial promise chain; tasks run one after another.
const locks = new Map();

function withGuildLock(guildId, task) {
  const prev = locks.get(guildId) ?? Promise.resolve();
  const next = prev.then(task, task); // run regardless of prior outcome
  locks.set(guildId, next.catch(() => {})); // keep the chain alive on errors
  return next;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function fetchInvites(guild, attempts = 3) {
  for (let i = 1; i <= attempts; i++) {
    try {
      const invites = await guild.invites.fetch();
      const map = new Map();
      for (const inv of invites.values()) {
        map.set(inv.code, { uses: inv.uses ?? 0, inviterId: inv.inviter?.id ?? null });
      }
      return map;
    } catch (e) {
      if (i === attempts) {
        logger.warn('Could not fetch invites after retries (need Manage Server permission?)',
          { guildId: guild.id, error: e.message, attempts });
        return null;
      }
      await sleep(300 * i);
    }
  }
  return null;
}

async function fetchVanityUses(guild) {
  if (!guild.vanityURLCode) return 0;
  try {
    const data = await guild.fetchVanityData();
    return data.uses ?? 0;
  } catch {
    return 0;
  }
}

async function persist(guildId, map, vanityUses) {
  const entries = [...map.entries()].map(([code, d]) => ({ code, inviterId: d.inviterId, uses: d.uses }));
  if (vanityUses) entries.push({ code: 'vanity', inviterId: null, uses: vanityUses });
  await storage.replaceCache(guildId, entries).catch(e =>
    logger.warn('Failed to persist invite cache', { guildId, error: e.message }),
  );
}

// Seed the snapshot for a guild (on ready / guildCreate / invite create+delete).
async function sync(guild) {
  return withGuildLock(guild.id, async () => {
    const map = await fetchInvites(guild);
    if (!map) return null;
    const vanityUses = await fetchVanityUses(guild);
    cache.set(guild.id, { invites: map, vanityUses });
    await persist(guild.id, map, vanityUses);
    return cache.get(guild.id);
  });
}

// Determine which invite a newly-joined member used, then advance the snapshot.
// Returns { type: 'normal'|'vanity'|'unknown', code, inviterId }.
async function detect(guild) {
  return withGuildLock(guild.id, () => detectLocked(guild));
}

async function detectLocked(guild) {
  const before = cache.get(guild.id) ?? { invites: new Map(), vanityUses: 0 };
  const after  = await fetchInvites(guild);

  // Couldn't read invites → leave the snapshot untouched and report unknown.
  if (!after) {
    return { type: 'unknown', code: 'unknown', inviterId: null };
  }

  const prevVanity = before.vanityUses ?? 0;
  const vanityUses = await fetchVanityUses(guild);
  const vanityRose = !!guild.vanityURLCode && vanityUses > prevVanity;

  // (a) Every code whose use-count went up since the last accounted snapshot.
  const candidates = [];
  for (const [code, data] of after) {
    const prevUses = before.invites.get(code)?.uses ?? 0;
    if (data.uses > prevUses) candidates.push(code);
  }

  // Prefer a concrete invite code over the (frequently-moving) vanity counter, so
  // a real inviter isn't stolen by vanity when both look like they rose at once.
  let matched     = candidates[0] ?? null;
  let usedVanity  = false;

  // (b) An invite that vanished because it reached its max-uses on this join.
  if (!matched) {
    for (const [code] of before.invites) {
      if (!after.has(code)) { matched = code; break; }
    }
  }

  // Only fall back to vanity when no concrete invite explains the join.
  if (!matched && vanityRose) usedVanity = true;

  if (candidates.length > 1) {
    // A burst landed between fetches; we can't know which joiner used which code.
    // Attribute the first and let the others be picked up by the next joins.
    logger.warn('Ambiguous invite attribution — multiple codes incremented at once',
      { guildId: guild.id, candidates });
  }

  // Build the next snapshot. Two rules keep attribution accurate under bursts,
  // where Discord's invite-use counts lag and jump by >1 between fetches:
  //   • monotonic — never let a stale/low fetch lower a code's recorded count;
  //   • consume-one — advance only the attributed code/vanity by a single use,
  //     leaving every other risen code/vanity "pending" so the next queued join
  //     is still attributed instead of falling through to unknown.
  const newSnap = new Map();
  for (const [code, data] of after) {
    const prevUses = before.invites.get(code)?.uses ?? 0;
    newSnap.set(code, { uses: Math.max(data.uses, prevUses), inviterId: data.inviterId });
  }
  for (const code of candidates) {
    const prevUses = before.invites.get(code)?.uses ?? 0;
    newSnap.get(code).uses = code === matched ? prevUses + 1 : prevUses;
  }
  const newVanity = usedVanity ? prevVanity + 1 : prevVanity;

  cache.set(guild.id, { invites: newSnap, vanityUses: newVanity });
  await persist(guild.id, newSnap, newVanity);

  if (matched) {
    const info = after.get(matched) ?? before.invites.get(matched);
    return { type: 'normal', code: matched, inviterId: info?.inviterId ?? null };
  }
  if (usedVanity) {
    return { type: 'vanity', code: 'vanity', inviterId: null };
  }
  return { type: 'unknown', code: 'unknown', inviterId: null };
}

module.exports = { sync, detect };
