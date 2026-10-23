'use strict';

const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const storage = require('../../core/storage');
const { buildLeaderboardEmbed } = require('../leaderboard/embed');

// ── Slash command definitions ────────────────────────────────────────────────
const invitesCommand = new SlashCommandBuilder()
  .setName('invites')
  .setDescription('მომხმარებლის მოწვევების სტატისტიკა')
  .addUserOption(o => o.setName('user').setDescription('ვისი სტატისტიკა (ნაგულისხმევად შენი)'));

const leaderboardCommand = new SlashCommandBuilder()
  .setName('leaderboard')
  .setDescription('მოწვევების ლიდერბორდი (top inviters)');

const invitedByCommand = new SlashCommandBuilder()
  .setName('invited-by')
  .setDescription('ვინ მოიწვია ეს მომხმარებელი')
  .addUserOption(o => o.setName('user').setDescription('მომხმარებელი').setRequired(true));

const invitedListCommand = new SlashCommandBuilder()
  .setName('invited-list')
  .setDescription('ვინ მოიწვია ამ მომხმარებელმა')
  .addUserOption(o => o.setName('user').setDescription('მომწვევი (ნაგულისხმევად შენ)'));

// ── Handlers ──────────────────────────────────────────────────────────────────
async function handleInvites(interaction, config) {
  const user  = interaction.options.getUser('user') ?? interaction.user;
  const stats = await storage.getInviterStats(config.guildId, user.id);

  const embed = new EmbedBuilder()
    .setTitle(`📨 ${user.username}-ის მოწვევები`)
    .setColor(0x5865F2)
    .setThumbnail(user.displayAvatarURL({ size: 64 }))
    .setDescription(`სულ: **${stats.total}** მოწვევა`)
    .addFields(
      { name: '✅ ნამდვილი', value: String(stats.regular), inline: true },
      { name: '⬅️ წავიდა',   value: String(stats.leaves),  inline: true },
      { name: '⚠️ Fake',     value: String(stats.fake),    inline: true },
      { name: '🎁 ბონუსი',   value: String(stats.bonus),   inline: true },
    )
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
}

async function handleLeaderboard(interaction, config) {
  await interaction.deferReply();
  const embed = await buildLeaderboardEmbed(interaction.guild, config, { limit: 10 });
  await interaction.editReply({ embeds: [embed] });
}

async function handleInvitedBy(interaction, config) {
  const user = interaction.options.getUser('user');
  const row  = await storage.getInvitedBy(config.guildId, user.id);

  if (!row) {
    return interaction.reply({ content: `<@${user.id}>-ზე ჩანაწერი არ მოიძებნა.`, flags: MessageFlags.Ephemeral });
  }

  let who;
  if (row.source === 'vanity')       who = '🔗 Vanity URL';
  else if (!row.inviter_id)          who = '❓ უცნობი';
  else                               who = `<@${row.inviter_id}>`;

  const joined = Math.floor(new Date(row.joined_at).getTime() / 1000);
  const embed = new EmbedBuilder()
    .setTitle(`${user.username} — ვინ მოიწვია`)
    .setColor(0x5865F2)
    .addFields(
      { name: 'მოწვევია',   value: who, inline: true },
      { name: 'შემოვიდა',  value: `<t:${joined}:R>`, inline: true },
      ...(row.fake ? [{ name: 'სტატუსი', value: '⚠️ Fake', inline: true }] : []),
      ...(row.left_at ? [{ name: 'სტატუსი', value: '⬅️ გასული', inline: true }] : []),
    )
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
}

async function handleInvitedList(interaction, config) {
  const user = interaction.options.getUser('user') ?? interaction.user;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const rows = await storage.getInvitedList(config.guildId, user.id, 30);
  if (!rows.length) {
    return interaction.editReply({ content: `<@${user.id}>-ს ჯერ არავინ მოუწვევია.` });
  }

  const lines = rows.map(r => {
    const t = Math.floor(new Date(r.joined_at).getTime() / 1000);
    const tag = r.left_at ? '⬅️' : (r.fake ? '⚠️' : '✅');
    return `${tag} <@${r.user_id}> — <t:${t}:R>`;
  });

  const embed = new EmbedBuilder()
    .setTitle(`📋 ${user.username}-ის მოწვეულები (${rows.length})`)
    .setColor(0x5865F2)
    .setDescription(lines.join('\n').slice(0, 4000))
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}

module.exports = {
  invitesCommand, leaderboardCommand, invitedByCommand, invitedListCommand,
  handleInvites, handleLeaderboard, handleInvitedBy, handleInvitedList,
};
