'use strict';

const { EmbedBuilder } = require('discord.js');
const storage     = require('../../core/storage');
const inviteCache = require('../../core/inviteCache');
const rewards     = require('./rewards');
const logger      = require('../../utils/logger');
const { sendLog, sendToChannel } = require('../../core/logChannel');
const giveaway = require('../giveaway/giveaway');

// Rich descriptor for a user: display name + @username + mention + ID.
function userLine(user, id) {
  if (!user) return `<@${id}>\n\`${id}\``;
  const display = user.globalName || user.username;
  return `**${display}** (@${user.username})\n<@${id}> • \`${id}\``;
}

function humanDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const d = Math.floor(ms / 86_400_000);
  const h = Math.floor((ms % 86_400_000) / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const parts = [];
  if (d) parts.push(`${d}დ`);
  if (h) parts.push(`${h}სთ`);
  if (m || !parts.length) parts.push(`${m}წთ`);
  return parts.join(' ');
}

function ordinalJoin(n) {
  return n <= 1 ? 'პირველად' : `**${n}**-ჯერ`;
}

// ── Duplicate-join guard ──────────────────────────────────────────────────────
// Discord can deliver the same guildMemberAdd more than once (gateway resume /
// reconnect). Without this, a duplicate would be processed as a second join and,
// in a burst, get attributed to a DIFFERENT pending invite — double-counting one
// joiner and stealing the real joiner's credit. We drop any repeat of the same
// (guild, user) seen within a short window.
const recentJoins = new Map(); // `${guildId}:${userId}` -> timestamp(ms)
const JOIN_DEDUP_MS = 10_000;

function isDuplicateJoin(guildId, userId) {
  const key = `${guildId}:${userId}`;
  const now = Date.now();
  const last = recentJoins.get(key);
  if (last !== undefined && now - last < JOIN_DEDUP_MS) return true;
  recentJoins.set(key, now);
  if (recentJoins.size > 1000) {
    for (const [k, t] of recentJoins) if (now - t > JOIN_DEDUP_MS) recentJoins.delete(k);
  }
  return false;
}

// When the first invite-diff is inconclusive, wait for Discord's use-counts to
// propagate and diff once more. Discord's per-invite (and vanity) counts can
// trail the guildMemberAdd gateway event by a second or two, which would
// otherwise make a perfectly normal join — or a vanity join — look "Unknown".
const RECHECK_DELAY_MS = 3_000;
const sleep = ms => new Promise(r => setTimeout(r, ms));

// New member joined → attribute the invite, store it, sync rewards, log it.
async function handleJoin(member, config) {
  const guild = member.guild;
  const user  = member.user;

  if (user.bot && !config.countBots) {
    logger.info(`Skipped bot join ${user.tag}`);
    return;
  }

  // Drop duplicate gateway deliveries of the same join (set synchronously before
  // any await, so a repeat that arrives mid-processing is still caught).
  if (isDuplicateJoin(guild.id, member.id)) {
    logger.warn('Skipped duplicate guildMemberAdd', { user: user.tag, userId: member.id });
    return;
  }

  // Prior history (before recording this join).
  const before = await storage.getUserJoinSummary(guild.id, member.id).catch(() => ({ joins: 0, leaves: 0 }));

  let result = await inviteCache.detect(guild);

  // Count-lag recovery: if the diff found nothing, give Discord a moment to
  // settle the use-counts and diff once more before we commit to "Unknown".
  // This is what turns a lagged real invite into the right inviter, and a
  // lagged vanity join into "Vanity" instead of "Unknown".
  if (result.type === 'unknown') {
    await sleep(RECHECK_DELAY_MS);
    const retry = await inviteCache.detect(guild);
    if (retry.type !== 'unknown') {
      logger.info('Attribution recovered on re-check', { userId: member.id, code: retry.code, source: retry.type });
      result = retry;
    }
  }

  let inviterId = result.type === 'normal' ? result.inviterId : null;
  const code    = result.code;
  const source  = result.type;

  // Bot-created "personal" invites are owned by the bot on Discord's side, so
  // re-attribute the join to the player who actually requested the link.
  if (code && code !== 'vanity' && code !== 'unknown') {
    const owner = await storage.getPersonalInviteOwner(guild.id, code).catch(() => null);
    if (owner) inviterId = owner;
  }

  // Fake detection — a join only counts as "real" when ALL hold:
  //   • account is older than the configured threshold (default 7 days)
  //   • it isn't the member's own invite code (no self-invites)
  //   • it's the member's first time joining (no rejoins)
  const ageMs      = Date.now() - user.createdTimestamp;
  const ageDays    = ageMs / 86_400_000;
  const rejoined   = before.joins > 0;
  const tooYoung   = config.fakeMinAgeDays > 0 && ageDays < config.fakeMinAgeDays;
  const selfInvite = !!inviterId && inviterId === member.id;
  const fake       = !!inviterId && (tooYoung || rejoined || selfInvite);

  await storage.recordJoin({ guildId: guild.id, userId: member.id, inviterId, code, source, fake })
    .catch(e => logger.error('Failed to record join', { error: e.message }));

  if (inviterId) await rewards.sync(guild, inviterId, config).catch(() => {});

  // Auto-enter the inviter into any active giveaway they now qualify for (writes
  // a frozen entry once they cross the threshold — read paths never recompute).
  if (inviterId && !fake) await giveaway.onRealInvite(guild.client, config, guild, inviterId).catch(() => {});

  // Resolve inviter for a rich line + their running totals.
  let inviterLine, inviterIdLine = null, inviterTotalsLine = null;
  if (source === 'vanity') {
    inviterLine = '🔗 Vanity URL';
  } else if (!inviterId) {
    inviterLine = '❓ ვერ დადგინდა (Unknown)';
  } else {
    let inviterUser = null;
    try { inviterUser = await guild.client.users.fetch(inviterId); } catch {}
    inviterLine   = userLine(inviterUser, inviterId);
    inviterIdLine = `\`${inviterId}\``;
    const st = await storage.getInviterStats(guild.id, inviterId).catch(() => null);
    if (st) inviterTotalsLine = `**${st.total}** სულ — ✅${st.regular} ⬅️${st.leaves} ⚠️${st.fake} 🎁${st.bonus}`;
  }

  const created   = Math.floor(user.createdTimestamp / 1000);
  const joinCount = before.joins + 1;

  const fakeReason = !fake ? null
    : [tooYoung   ? `ახალი ანგარიში (<${config.fakeMinAgeDays} დღე)` : null,
       selfInvite ? 'საკუთარი ლინკი (self-invite)' : null,
       rejoined   ? 'ხელახალი შემოსვლა (rejoin)' : null].filter(Boolean).join(' • ');

  const fields = [
    { name: '👤 წევრი',    value: userLine(user, member.id), inline: false },
    { name: '📨 მოიწვია', value: inviterLine, inline: true },
  ];
  if (inviterTotalsLine) fields.push({ name: '📊 მომწვევის ჯამი', value: inviterTotalsLine, inline: true });
  fields.push(
    { name: '🔢 შემოსვლა', value: `${ordinalJoin(joinCount)}${before.leaves ? ` (გასულა ${before.leaves}-ჯერ)` : ''}`, inline: true },
    { name: '🗓️ ანგარიში', value: `<t:${created}:F>\n<t:${created}:R>`, inline: true },
    { name: '👥 სერვერზე', value: `${guild.memberCount} წევრი`, inline: true },
  );
  if (code && code !== 'vanity' && code !== 'unknown') {
    fields.push({ name: '🔗 კოდი', value: `\`${code}\``, inline: true });
  }
  if (fake) fields.push({ name: '⚠️ Fake', value: fakeReason || 'fake', inline: false });

  const embed = new EmbedBuilder()
    .setTitle('📥 წევრი შემოვიდა')
    .setColor(fake ? 0xFEE75C : 0x57F287)
    .setThumbnail(user.displayAvatarURL({ size: 128 }))
    .addFields(fields)
    .setFooter({ text: `User ID: ${member.id}` })
    .setTimestamp();

  await sendLog(guild, config, embed);

  // If this invite code is bound to a channel, log the join there with a running count.
  if (code && code !== 'vanity' && code !== 'unknown') {
    await notifyTrackedLink(guild, code, user, member.id, inviterId, fake).catch(e =>
      logger.warn('Tracked-link notify failed', { code, error: e.message }));
  }

  logger.info('Join attributed', { user: user.tag, userId: member.id, inviterId, code, source, fake, joinCount });
}

// Post to a tracked link's channel when someone joins through that code.
async function notifyTrackedLink(guild, code, user, userId, inviterId, fake) {
  const link = await storage.getTrackedLink(guild.id, code).catch(() => null);
  if (!link) return;

  const stats   = await storage.getCodeJoinStats(guild.id, code);
  const label   = link.label ? `**${link.label}** (\`${code}\`)` : `\`${code}\``;
  const created = Math.floor(user.createdTimestamp / 1000);

  const embed = new EmbedBuilder()
    .setTitle('🔗 ახალი შემოსვლა მონიტორინგ ლინკიდან')
    .setColor(fake ? 0xFEE75C : 0x57F287)
    .setThumbnail(user.displayAvatarURL({ size: 64 }))
    .setDescription(`ლინკი: ${label}`)
    .addFields(
      { name: '👤 წევრი', value: userLine(user, userId), inline: false },
      { name: '📨 მომწვევი', value: inviterId ? `<@${inviterId}>` : '—', inline: true },
      { name: '🗓️ ანგარიში', value: `<t:${created}:R>`, inline: true },
      { name: '📊 ამ ლინკით სულ', value: `**${stats.total}** (✅${stats.active} ⬅️${stats.left} ⚠️${stats.fake})`, inline: false },
    )
    .setFooter({ text: `Invite code: ${code}` })
    .setTimestamp();

  await sendToChannel(guild.client, link.channel_id, { embeds: [embed] });
}

// Member left → mark their join as left, re-sync the inviter's rewards, log it.
async function handleLeave(member, config) {
  const guild = member.guild;
  const user  = member.user;

  // Grab the active join record (for joined_at + inviter) before flagging it left.
  const rec     = await storage.getInvitedBy(guild.id, member.id).catch(() => null);
  const summary = await storage.getUserJoinSummary(guild.id, member.id).catch(() => ({ joins: 0, leaves: 0 }));
  const inviterId = await storage.markLeft(guild.id, member.id).catch(() => null);

  if (inviterId) await rewards.sync(guild, inviterId, config).catch(() => {});

  let inviterLine;
  if (rec?.source === 'vanity') inviterLine = '🔗 Vanity URL';
  else if (!inviterId)          inviterLine = '❓ უცნობი';
  else {
    let inviterUser = null;
    try { inviterUser = await guild.client.users.fetch(inviterId); } catch {}
    inviterLine = userLine(inviterUser, inviterId);
  }

  const stayed = rec?.joined_at ? humanDuration(Date.now() - new Date(rec.joined_at).getTime()) : '—';

  const fields = [
    { name: '👤 წევრი',   value: userLine(user, member.id), inline: false },
    { name: '📨 მოიწვია', value: inviterLine, inline: true },
    { name: '⏳ დაჰყო',   value: stayed, inline: true },
    { name: '🔢 ისტორია', value: `შემოსულა **${summary.joins}**-ჯერ • გასულა **${summary.leaves + 1}**-ჯერ`, inline: true },
  ];
  if (rec?.invite_code && rec.invite_code !== 'vanity' && rec.invite_code !== 'unknown') {
    fields.push({ name: '🔗 კოდი', value: `\`${rec.invite_code}\``, inline: true });
  }
  fields.push({ name: '👥 სერვერზე', value: `${guild.memberCount} წევრი`, inline: true });

  const embed = new EmbedBuilder()
    .setTitle('📤 წევრი გავიდა')
    .setColor(0xED4245)
    .setThumbnail(user?.displayAvatarURL ? user.displayAvatarURL({ size: 128 }) : null)
    .addFields(fields)
    .setFooter({ text: `User ID: ${member.id}` })
    .setTimestamp();

  await sendLog(guild, config, embed);
  logger.info('Leave recorded', { user: user?.tag ?? member.id, userId: member.id, inviterId });
}

module.exports = { handleJoin, handleLeave };
