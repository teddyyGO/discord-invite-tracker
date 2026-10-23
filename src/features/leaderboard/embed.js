'use strict';

const { EmbedBuilder } = require('discord.js');
const storage = require('../../core/storage');

function rankBadge(i) {
  return ['🥇', '🥈', '🥉'][i] ?? `\`#${String(i + 1).padStart(2, ' ')}\``;
}

// Drop inviters who carry any of the hidden roles. Only the candidate inviters
// (a bounded set) are resolved, so this stays cheap even on big servers.
async function filterHiddenRoles(guild, rows, hiddenRoles) {
  if (!hiddenRoles.length || !rows.length) return rows;
  const ids = rows.map(r => r.inviterId);
  let members;
  try {
    members = await guild.members.fetch({ user: ids });
  } catch {
    members = guild.members.cache; // fetch failed → best-effort with what's cached
  }
  return rows.filter(r => {
    const m = members.get(r.inviterId);
    if (!m) return true; // not resolvable → can't determine role, keep it
    return !hiddenRoles.some(roleId => m.roles.cache.has(roleId));
  });
}

// Build the leaderboard embed shared by /leaderboard and the smart (pinned) board.
// `opts.live` marks it as the auto-refreshing board and shows the next-refresh hint.
async function buildLeaderboardEmbed(guild, config, opts = {}) {
  const limit  = opts.limit ?? 10;
  const hidden = await storage.getHidden(config.guildId).catch(() => ({ users: [], roles: [] }));

  // Over-fetch when roles are hidden so post-filtering still leaves a full board.
  const fetchLimit = hidden.roles.length ? Math.max(limit * 4, 40) : limit;

  const [rawRows, overview] = await Promise.all([
    storage.getLeaderboard(config.guildId, fetchLimit, hidden.users),
    storage.getOverview(config.guildId).catch(() => null),
  ]);

  const rows = (await filterHiddenRoles(guild, rawRows, hidden.roles)).slice(0, limit);

  const embed = new EmbedBuilder()
    .setColor(0xFEE75C)
    .setTitle(opts.live ? '🏆 ლაივ ლიდერბორდი — Top Inviters' : '🏆 მოწვევების ლიდერბორდი')
    .setTimestamp();

  if (guild.iconURL) {
    const icon = guild.iconURL({ size: 128 });
    if (icon) embed.setThumbnail(icon);
  }

  if (!rows.length) {
    embed.setDescription('ჯერ მოწვევები არ დაფიქსირებულა.');
    return embed;
  }

  const lines = rows.map((r, i) =>
    `${rankBadge(i)} <@${r.inviterId}> — **${r.total}**\n` +
    `⠀⠀✅ ${r.regular} • ⬅️ ${r.leaves} • ⚠️ ${r.fake} • 🎁 ${r.bonus}`,
  );

  embed.setDescription(lines.join('\n'));

  if (overview) {
    embed.addFields({
      name: '📊 სერვერის მიმოხილვა',
      value:
        `👥 აქტიური მოწვეული: **${overview.active}**\n` +
        `📨 მომწვევები: **${overview.inviters}** • სულ შემოსვლა: **${overview.totalJoins}**\n` +
        `⬅️ გასული: **${overview.leftTotal}** • ⚠️ Fake: **${overview.fakeTotal}**`,
      inline: false,
    });
  }

  embed.setFooter({
    text: opts.live
      ? 'ავტომატურად ახლდება • ბოლო განახლება'
      : 'ლეგენდა: ✅ ნამდვილი • ⬅️ გასული • ⚠️ fake • 🎁 ბონუსი',
  });

  return embed;
}

module.exports = { buildLeaderboardEmbed };
