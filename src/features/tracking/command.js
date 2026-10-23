'use strict';

const { SlashCommandBuilder, EmbedBuilder, MessageFlags, ChannelType, PermissionFlagsBits } = require('discord.js');
const storage = require('../../core/storage');
const { hasModeratorAccess } = require('../../core/permissions');

const MANAGE = PermissionFlagsBits.ManageGuild.toString();

// Accept a raw code or a full invite URL (discord.gg/abc, discord.com/invite/abc).
function parseInviteCode(input) {
  if (!input) return null;
  const trimmed = input.trim();
  const m = trimmed.match(/(?:discord(?:\.gg|app\.com|\.com)\/(?:invite\/)?)([A-Za-z0-9-]+)/i);
  const code = (m ? m[1] : trimmed).replace(/^\/+|\/+$/g, '');
  return /^[A-Za-z0-9-]+$/.test(code) ? code : null;
}

const trackInviteCommand = new SlashCommandBuilder()
  .setName('trackinvite')
  .setDescription('მიამაგრე კონკრეტული მოწვევის ლინკი არხს — შემოსვლები იქ დაილოგება')
  .setDefaultMemberPermissions(MANAGE)
  .addStringOption(o => o.setName('invite').setDescription('მოწვევის კოდი ან ლინკი').setRequired(true))
  .addChannelOption(o => o.setName('channel').setDescription('სად დაილოგოს ამ ლინკის შემოსვლები')
    .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setRequired(true))
  .addStringOption(o => o.setName('label').setDescription('სახელი ამ ლინკისთვის (არასავალდებულო)'));

const untrackInviteCommand = new SlashCommandBuilder()
  .setName('untrackinvite')
  .setDescription('მოხსენი მონიტორინგი მოწვევის ლინკიდან')
  .setDefaultMemberPermissions(MANAGE)
  .addStringOption(o => o.setName('invite').setDescription('მოწვევის კოდი ან ლინკი').setRequired(true));

const trackedLinksCommand = new SlashCommandBuilder()
  .setName('trackedlinks')
  .setDescription('ყველა მონიტორინგ ლინკის სია სტატისტიკით')
  .setDefaultMemberPermissions(MANAGE);

async function handleTrackInvite(interaction, config) {
  if (!hasModeratorAccess(interaction.member, config)) {
    return interaction.reply({ content: 'ამის უფლება არ გაქვს.', flags: MessageFlags.Ephemeral });
  }

  const code    = parseInviteCode(interaction.options.getString('invite'));
  const channel = interaction.options.getChannel('channel');
  const label   = interaction.options.getString('label') ?? null;

  if (!code) {
    return interaction.reply({ content: 'არასწორი მოწვევის კოდი/ლინკი.', flags: MessageFlags.Ephemeral });
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  // Best-effort verify the code is a real invite for this guild (warn, don't block).
  let warn = '';
  try {
    const invites = await interaction.guild.invites.fetch();
    if (!invites.has(code) && code !== 'vanity') {
      warn = '\n⚠️ ეს კოდი ამ სერვერის აქტიურ მოწვევებში ვერ ვიპოვე — დარწმუნდი რომ სწორია.';
    }
  } catch { /* missing Manage Server perm — skip verification */ }

  await storage.addTrackedLink(config.guildId, code, channel.id, label, interaction.user.id);
  const stats = await storage.getCodeJoinStats(config.guildId, code);

  await interaction.editReply({
    content: `✅ ლინკი \`${code}\`${label ? ` (**${label}**)` : ''} მიება არხს <#${channel.id}>.\n` +
      `ამ ლინკით აქამდე: **${stats.total}** შემოსვლა (✅${stats.active} ⬅️${stats.left} ⚠️${stats.fake}).` + warn,
  });
}

async function handleUntrackInvite(interaction, config) {
  if (!hasModeratorAccess(interaction.member, config)) {
    return interaction.reply({ content: 'ამის უფლება არ გაქვს.', flags: MessageFlags.Ephemeral });
  }

  const code = parseInviteCode(interaction.options.getString('invite'));
  if (!code) {
    return interaction.reply({ content: 'არასწორი მოწვევის კოდი/ლინკი.', flags: MessageFlags.Ephemeral });
  }

  const removed = await storage.removeTrackedLink(config.guildId, code);
  return interaction.reply({
    content: removed ? `✅ \`${code}\`-ის მონიტორინგი მოიხსნა.` : `\`${code}\` მონიტორინგში არ იყო.`,
    flags: MessageFlags.Ephemeral,
  });
}

async function handleTrackedLinks(interaction, config) {
  if (!hasModeratorAccess(interaction.member, config)) {
    return interaction.reply({ content: 'ამის უფლება არ გაქვს.', flags: MessageFlags.Ephemeral });
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const links = await storage.listTrackedLinks(config.guildId);
  if (!links.length) {
    return interaction.editReply({ content: 'ჯერ არცერთი ლინკი არ არის მონიტორინგზე. გამოიყენე `/trackinvite`.' });
  }

  const stats = await Promise.all(links.map(l => storage.getCodeJoinStats(config.guildId, l.invite_code)));
  const lines = links.map((l, i) => {
    const s = stats[i];
    const name = l.label ? `**${l.label}** \`${l.invite_code}\`` : `\`${l.invite_code}\``;
    return `${name} → <#${l.channel_id}>\n⠀⠀📊 **${s.total}** (✅${s.active} ⬅️${s.left} ⚠️${s.fake})`;
  });

  const embed = new EmbedBuilder()
    .setTitle('🔗 მონიტორინგ ლინკები')
    .setColor(0x5865F2)
    .setDescription(lines.join('\n').slice(0, 4000))
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}

module.exports = {
  trackInviteCommand, untrackInviteCommand, trackedLinksCommand,
  handleTrackInvite, handleUntrackInvite, handleTrackedLinks,
};
