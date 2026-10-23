'use strict';

// Invite-gated giveaway engine.
//
// A manager starts a giveaway with a prize, a duration, and a required number of
// invites. From that moment, any member who gains that many REAL invites (not
// fake, invitee still in the server) is automatically a participant — eligibility
// is computed live from invite_joins (joined_at >= the giveaway's created_at), so
// "new invites only this week" and "resets each giveaway" come for free, and it all
// survives restarts. A 30s sweep refreshes the live participant count and fires the
// winner pick at the end time (even if the bot was down when it elapsed).

const {
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags,
} = require('discord.js');
const storage = require('../../core/storage');
const logger  = require('../../utils/logger');
const { hasModeratorAccess } = require('../../core/permissions');
const { sendToChannel } = require('../../core/logChannel');

const SWEEP_MS        = 30_000;
const MAX_DURATION_MS = 60 * 86_400_000; // 60-day hard cap

let sweepTimer = null;
const lastCount = new Map(); // giveawayId -> last participant count we rendered
const ending    = new Set(); // giveawayIds currently being finalized (race guard)

// ── Duration parsing ("7d", "72h", "1w2d", "90m", or a bare number = days) ──────────
const UNIT_MS = { w: 604_800_000, d: 86_400_000, h: 3_600_000, m: 60_000 };
function parseDuration(input) {
  if (!input) return null;
  const str = String(input).trim().toLowerCase();
  let ms = 0, matched = false, m;
  const re = /(\d+)\s*(w|d|h|m)/g;
  while ((m = re.exec(str)) !== null) { matched = true; ms += parseInt(m[1], 10) * UNIT_MS[m[2]]; }
  if (!matched && /^\d+$/.test(str)) { ms = parseInt(str, 10) * UNIT_MS.d; matched = true; } // bare = days
  if (!matched || ms <= 0 || ms > MAX_DURATION_MS) return null;
  return ms;
}

const unix = d => Math.floor(new Date(d).getTime() / 1000);

// ── Embeds ──────────────────────────────────────────────────────────────────────
function createdEmbed(g, participants) {
  const end = unix(g.ends_at);
  return new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle(`🎉 ${g.prize}`)
    .setDescription('🎉 **გათამაშება დაიწყო!** მოიწვიე მეგობრები და ავტომატურად მოხვდები გათამაშებაში.')
    .addFields(
      { name: '⏳ მთავრდება', value: `<t:${end}:F>\n<t:${end}:R>`, inline: false },
      { name: '👥 მონაწილეები', value: `**${participants}**`, inline: true },
      { name: '🎯 საჭირო მოწვევები', value: `**${g.required_invites}**`, inline: true },
    )
    .setFooter({ text: `Giveaway #${g.id} • ითვლება ახალი მოწვევები ამ გათამაშების დაწყებიდან` })
    .setTimestamp(new Date(g.created_at));
}

function endedEmbed(g, winnerId) {
  return new EmbedBuilder()
    .setColor(winnerId ? 0x57F287 : 0xED4245)
    .setTitle(`🎉 ${g.prize}`)
    .setDescription(winnerId
      ? `🎉 **გათამაშება დასრულდა!**\n\n🏆 გამარჯვებული: <@${winnerId}>`
      : '🎉 **გათამაშება დასრულდა!**\n\nმონაწილეები არ აღმოჩნდა (no eligible participants).')
    .setFooter({ text: `Giveaway #${g.id}` })
    .setTimestamp();
}

// ── Participation button ──────────────────────────────────────────────────────────
const GW_CHECK = 'gw_check:'; // customId is `gw_check:<giveawayId>`

function giveawayComponents(g) {
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${GW_CHECK}${g.id}`)
      .setLabel('ჩემი მონაწილეობა')
      .setEmoji('🎟️')
      .setStyle(ButtonStyle.Secondary),
  )];
}

function isGiveawayButton(customId) {
  return typeof customId === 'string' && customId.startsWith(GW_CHECK);
}

// Show the clicker, privately, how many eligible invites they have for this
// giveaway and whether they're in.
async function handleGiveawayButton(interaction, config) {
  const id = parseInt(interaction.customId.slice(GW_CHECK.length), 10);
  const g  = await storage.getGiveaway(config.guildId, id);
  if (!g) {
    return interaction.reply({ content: 'ეს გათამაშება ვეღარ მოიძებნა.', flags: MessageFlags.Ephemeral });
  }

  const isStaff = hasModeratorAccess(interaction.member, config);
  const count   = await storage.countUserInvitesSince(config.guildId, interaction.user.id, g.created_at);
  const need    = Math.max(0, g.required_invites - count);

  // Read the stored entry; lazily enter the clicker if they already qualify but
  // weren't recorded yet (e.g. they crossed the line while the bot was down).
  let entered = await storage.isGiveawayEntrant(g.id, interaction.user.id);
  if (g.status === 'active' && !isStaff && !entered && count >= g.required_invites) {
    await storage.addGiveawayEntry(g.id, interaction.user.id, count).catch(() => {});
    entered = true;
  }
  const inLive = g.status === 'active' && entered;

  let status;
  if (g.status === 'ended') {
    status = g.winner_id === interaction.user.id ? '🏆 შენ მოიგე!' : '🏁 გათამაშება დასრულდა.';
  } else if (g.status === 'cancelled') {
    status = '❌ გათამაშება გაუქმდა.';
  } else if (isStaff) {
    status = '🛡️ სტაფი ვერ მონაწილეობს გათამაშებაში.';
  } else if (entered) {
    status = '✅ შენ მონაწილეობ ამ გათამაშებაში!';
  } else {
    status = `⏳ დაგჭირდება კიდევ **${need}** მოწვევა მონაწილეობისთვის.`;
  }

  const embed = new EmbedBuilder()
    .setColor(inLive ? 0x57F287 : 0x5865F2)
    .setTitle(`🎟️ ${g.prize} — შენი მონაწილეობა`)
    .setDescription(
      `ახალი ნამდვილი მოწვევები (გათამაშების დაწყებიდან): **${count} / ${g.required_invites}**\n${status}`,
    )
    .setFooter({ text: `Giveaway #${g.id}` });

  return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

// ── Winner pick ─────────────────────────────────────────────────────────────────
// Random stored entrant still in the guild and not staff. `exclude` skips IDs
// (e.g. the previous winner on a reroll). Fetches lazily — usually just one.
async function pickWinner(guild, config, g, exclude = new Set()) {
  const entrants = await storage.getGiveawayEntrants(g.id);
  const poolIds  = entrants.filter(id => !exclude.has(id));
  while (poolIds.length) {
    const [id] = poolIds.splice(Math.floor(Math.random() * poolIds.length), 1);
    let member;
    try { member = await guild.members.fetch(id); } catch { continue; } // left the server
    if (hasModeratorAccess(member, config)) continue;                    // staff excluded
    return member;
  }
  return null;
}

async function fetchGiveawayMessage(client, g) {
  if (!g.message_id) return null;
  try {
    const channel = await client.channels.fetch(g.channel_id);
    return await channel.messages.fetch(g.message_id);
  } catch { return null; }
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────────
async function refreshOne(client, config, g) {
  const count = await storage.countGiveawayEntries(g.id); // cheap COUNT(*) on stored entries
  if (lastCount.get(g.id) === count) return; // unchanged → skip the edit
  const message = await fetchGiveawayMessage(client, g);
  if (!message) return;
  await message.edit({ embeds: [createdEmbed(g, count)], components: giveawayComponents(g) })
    .then(() => lastCount.set(g.id, count))
    .catch(() => {});
}

async function finalize(client, config, g, winnerMember) {
  // Mark ended first — idempotent guard so the sweep and a manual /end can't both fire.
  const won = await storage.endGiveawayRow(g.id, winnerMember?.id ?? null);
  if (!won) return false;

  const message = await fetchGiveawayMessage(client, g);
  if (message) await message.edit({ embeds: [endedEmbed(g, winnerMember?.id ?? null)], components: [] }).catch(() => {});

  // Announcement — the content mention actually pings the winner.
  const content = winnerMember
    ? `🎉 გილოცავ <@${winnerMember.id}>! შენ მოიგე **${g.prize}**! 🎉`
    : `გათამაშება **${g.prize}** დასრულდა — მონაწილეები არ აღმოჩნდა.`;
  // Only ping the winner — the mod-supplied prize text must not trigger @everyone/role pings.
  await sendToChannel(client, g.channel_id, {
    content, embeds: [endedEmbed(g, winnerMember?.id ?? null)],
    allowedMentions: { users: winnerMember ? [winnerMember.id] : [] },
  });

  lastCount.delete(g.id);
  logger.info('Giveaway ended', { id: g.id, prize: g.prize, winnerId: winnerMember?.id ?? null });
  return true;
}

async function endDue(client, config, g) {
  if (ending.has(g.id)) return;
  ending.add(g.id);
  try {
    const guild  = client.guilds.cache.get(g.guild_id);
    const winner = guild ? await pickWinner(guild, config, g) : null;
    await finalize(client, config, g, winner);
  } catch (e) {
    logger.error('Failed to end giveaway', { id: g.id, error: e.message });
  } finally {
    ending.delete(g.id);
  }
}

async function sweep(client, config) {
  let actives;
  try { actives = await storage.getActiveGiveaways(config.guildId); }
  catch (e) { return logger.warn('Giveaway sweep query failed', { error: e.message }); }

  const now = Date.now();
  for (const g of actives) {
    if (new Date(g.ends_at).getTime() <= now) await endDue(client, config, g);
    else await refreshOne(client, config, g).catch(() => {});
  }
}

function startSweep(client, config) {
  if (sweepTimer) clearInterval(sweepTimer);
  sweepTimer = setInterval(() => { sweep(client, config).catch(() => {}); }, SWEEP_MS);
}

// Called after a REAL invite is attributed: freeze the inviter into any active
// giveaway they now qualify for. One INSERT per inviter (only when they first
// cross the line) — no full recompute on the join hot path.
async function onRealInvite(client, config, guild, inviterId) {
  if (!inviterId) return;
  let actives;
  try { actives = await storage.getActiveGiveaways(config.guildId); } catch { return; }
  if (!actives.length) return;

  let member = guild.members.cache.get(inviterId);
  if (!member) { try { member = await guild.members.fetch(inviterId); } catch { member = null; } }
  if (member && hasModeratorAccess(member, config)) return; // staff never enter

  for (const g of actives) {
    try {
      if (await storage.isGiveawayEntrant(g.id, inviterId)) continue;
      const count = await storage.countUserInvitesSince(g.guild_id, inviterId, g.created_at);
      if (count >= g.required_invites && await storage.addGiveawayEntry(g.id, inviterId, count)) {
        logger.info('Giveaway entry', { giveawayId: g.id, userId: inviterId, invites: count });
      }
    } catch (e) {
      logger.warn('Giveaway entry check failed', { giveawayId: g.id, error: e.message });
    }
  }
}

// Startup backfill: insert any entries that should exist but don't (e.g. members
// crossed the threshold while the bot was down). One-time recompute, not per-read.
async function reconcile(client, config) {
  let actives;
  try { actives = await storage.getActiveGiveaways(config.guildId); } catch { return; }
  for (const g of actives) {
    try {
      const guild    = client.guilds.cache.get(g.guild_id);
      const eligible = await storage.getEligibleInviters(g.guild_id, g.created_at, g.required_invites);
      for (const e of eligible) {
        const m = guild?.members.cache.get(e.inviterId);
        if (m && hasModeratorAccess(m, config)) continue; // skip cached staff
        await storage.addGiveawayEntry(g.id, e.inviterId, e.invites); // ON CONFLICT DO NOTHING
      }
    } catch (err) {
      logger.warn('Giveaway reconcile failed', { id: g.id, error: err.message });
    }
  }
}

// On startup: backfill entries, end anything whose timer elapsed during downtime,
// then keep sweeping.
async function init(client, config) {
  await reconcile(client, config).catch(e => logger.warn('Giveaway reconcile failed', { error: e.message }));
  await sweep(client, config).catch(e => logger.warn('Initial giveaway sweep failed', { error: e.message }));
  startSweep(client, config);
  logger.info('Giveaway engine started');
}

// ── Command-facing operations ─────────────────────────────────────────────────────
async function startGiveaway({ config, channel, prize, durationMs, requiredInvites }) {
  const endsAt = new Date(Date.now() + durationMs);
  const g = await storage.createGiveaway({
    guildId: config.guildId, channelId: channel.id, prize, requiredInvites, endsAt,
  });
  try {
    const message = await channel.send({ embeds: [createdEmbed(g, 0)], components: giveawayComponents(g) });
    await storage.setGiveawayMessage(g.id, message.id);
    lastCount.set(g.id, 0);
    logger.info('Giveaway created', { id: g.id, prize, requiredInvites, endsAt });
    return { giveaway: { ...g, message_id: message.id } };
  } catch (e) {
    await storage.cancelGiveawayRow(config.guildId, g.id).catch(() => {}); // couldn't post → undo
    throw e;
  }
}

async function endNow(client, config, id) {
  const g = await storage.getGiveaway(config.guildId, id);
  if (!g) return { ok: false, reason: 'not_found' };
  if (g.status !== 'active') return { ok: false, reason: 'not_active' };
  const guild  = client.guilds.cache.get(g.guild_id);
  const winner = guild ? await pickWinner(guild, config, g) : null;
  const done   = await finalize(client, config, g, winner);
  return { ok: done, reason: done ? null : 'already_ended', winnerId: winner?.id ?? null };
}

async function reroll(client, config, id) {
  const g = await storage.getGiveaway(config.guildId, id);
  if (!g) return { ok: false, reason: 'not_found' };
  if (g.status !== 'ended') return { ok: false, reason: 'not_ended' };
  const guild = client.guilds.cache.get(g.guild_id);
  if (!guild) return { ok: false, reason: 'not_found' };
  const winner = await pickWinner(guild, config, g, new Set(g.winner_id ? [g.winner_id] : []));
  await storage.setGiveawayWinner(g.id, winner?.id ?? null);
  if (winner) {
    await sendToChannel(client, g.channel_id, {
      content: `🎉 ხელახალი გათამაშება — ახალი გამარჯვებული: <@${winner.id}>! შენ მოიგე **${g.prize}**! 🎉`,
      embeds: [endedEmbed(g, winner.id)],
      allowedMentions: { users: [winner.id] },
    });
  }
  return { ok: true, winnerId: winner?.id ?? null };
}

async function cancel(client, config, id) {
  const g = await storage.getGiveaway(config.guildId, id);
  if (!g) return { ok: false, reason: 'not_found' };
  const done = await storage.cancelGiveawayRow(config.guildId, id);
  if (!done) return { ok: false, reason: 'not_active' };
  const message = await fetchGiveawayMessage(client, g);
  if (message) {
    const e = new EmbedBuilder().setColor(0x9aa0aa).setTitle(`🎉 ${g.prize}`)
      .setDescription('❌ გათამაშება გაუქმდა.').setFooter({ text: `Giveaway #${g.id}` });
    await message.edit({ embeds: [e], components: [] }).catch(() => {});
  }
  lastCount.delete(g.id);
  return { ok: true };
}

module.exports = {
  init, parseDuration, startGiveaway, endNow, reroll, cancel,
  isGiveawayButton, handleGiveawayButton, onRealInvite,
};
