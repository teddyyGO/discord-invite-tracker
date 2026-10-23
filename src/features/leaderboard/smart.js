'use strict';

const {
  SlashCommandBuilder, EmbedBuilder, MessageFlags, PermissionFlagsBits,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
} = require('discord.js');
const storage = require('../../core/storage');
const logger  = require('../../utils/logger');
const { hasModeratorAccess } = require('../../core/permissions');
const { buildLeaderboardEmbed } = require('./embed');
const { replyWithPersonalInvite } = require('../invites/personal');

const BTN_CHECK  = 'lb_check';
const BTN_INVITE = 'lb_invite';

// The two buttons under the smart leaderboard.
function leaderboardComponents() {
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(BTN_CHECK).setLabel('ჩემი მოწვევები').setEmoji('📊').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(BTN_INVITE).setLabel('ლინკის შექმნა').setEmoji('🔗').setStyle(ButtonStyle.Primary),
  )];
}

const REFRESH_MS = 60_000; // edit the pinned message once a minute

// Module-level loop state (one smart board per configured guild).
let timer   = null;
let current = null; // { channelId, messageId }

const smartLeaderboardCommand = new SlashCommandBuilder()
  .setName('smartleaderboard')
  .setDescription('აქ დააგზავნის ავტო-განახლებად, დამაგრებულ ლიდერბორდს')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild.toString());

// Edit the tracked message in place. Clears state if the message is gone.
async function refresh(client, config) {
  if (!current) return;
  try {
    const channel = await client.channels.fetch(current.channelId);
    const message = await channel.messages.fetch(current.messageId);
    const embed   = await buildLeaderboardEmbed(channel.guild, config, { limit: 10, live: true });
    await message.edit({ embeds: [embed], components: leaderboardComponents() });
  } catch (e) {
    // 10008 = Unknown Message, 10003 = Unknown Channel → the board was deleted.
    if (e.code === 10008 || e.code === 10003) {
      logger.warn('Smart leaderboard message gone — clearing', { error: e.message });
      await storage.deleteSmartLeaderboard(config.guildId).catch(() => {});
      stop();
    } else {
      logger.warn('Smart leaderboard refresh failed', { error: e.message, code: e.code });
    }
  }
}

function stop() {
  if (timer) { clearInterval(timer); timer = null; }
  current = null;
}

function startLoop(client, config) {
  if (timer) clearInterval(timer);
  timer = setInterval(() => { refresh(client, config).catch(() => {}); }, REFRESH_MS);
}

// On startup: re-attach to a previously created board and resume refreshing it.
async function init(client, config) {
  const saved = await storage.getSmartLeaderboard(config.guildId).catch(() => null);
  if (!saved) return;
  current = { channelId: saved.channel_id, messageId: saved.message_id };
  await refresh(client, config);
  if (current) { startLoop(client, config); logger.info('Smart leaderboard resumed', current); }
}

async function handleSmartLeaderboard(interaction, config) {
  if (!hasModeratorAccess(interaction.member, config)) {
    return interaction.reply({ content: 'ამის უფლება არ გაქვს.', flags: MessageFlags.Ephemeral });
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const channel = interaction.channel;
  const embed   = await buildLeaderboardEmbed(interaction.guild, config, { limit: 10, live: true });

  // Remove the previous board's message if one exists, so only one stays live.
  const prev = await storage.getSmartLeaderboard(config.guildId).catch(() => null);
  if (prev) {
    try {
      const ch  = await interaction.client.channels.fetch(prev.channel_id);
      const msg = await ch.messages.fetch(prev.message_id);
      await msg.delete();
    } catch { /* already gone */ }
  }

  let message;
  try {
    message = await channel.send({ embeds: [embed], components: leaderboardComponents() });
  } catch (e) {
    return interaction.editReply({ content: `ვერ გავაგზავნე შეტყობინება ამ არხში: ${e.message}` });
  }

  let pinned = true;
  try {
    await message.pin();
  } catch (e) {
    pinned = false;
    logger.warn('Could not pin smart leaderboard', { error: e.message, code: e.code });
  }

  await storage.saveSmartLeaderboard(config.guildId, channel.id, message.id).catch(e =>
    logger.error('Failed to persist smart leaderboard', { error: e.message }));

  current = { channelId: channel.id, messageId: message.id };
  startLoop(interaction.client, config);

  await interaction.editReply({
    content: pinned
      ? '✅ ლაივ ლიდერბორდი შეიქმნა და დაიმაგრა. ყოველ წუთს ავტომატურად განახლდება.'
      : '✅ ლაივ ლიდერბორდი შეიქმნა (ვერ დავამაგრე — დამჭირდება **Manage Messages** უფლება ამ არხში). ყოველ წუთს განახლდება.',
  });
}

// ── Button handlers (on the smart leaderboard message) ────────────────────────────
function isLeaderboardButton(customId) {
  return customId === BTN_CHECK || customId === BTN_INVITE;
}

async function handleLeaderboardButton(interaction, config) {
  if (interaction.customId === BTN_INVITE) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    return replyWithPersonalInvite(interaction, config);
  }

  // BTN_CHECK → show the clicker their own invite stats, privately.
  const stats = await storage.getInviterStats(config.guildId, interaction.user.id);
  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle(`📊 შენი მოწვევები`)
    .setThumbnail(interaction.user.displayAvatarURL({ size: 64 }))
    .setDescription(`სულ: **${stats.total}** მოწვევა`)
    .addFields(
      { name: '✅ ნამდვილი', value: String(stats.regular), inline: true },
      { name: '⬅️ წავიდა',   value: String(stats.leaves),  inline: true },
      { name: '⚠️ Fake',     value: String(stats.fake),    inline: true },
      { name: '🎁 ბონუსი',   value: String(stats.bonus),   inline: true },
    );
  return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

module.exports = {
  smartLeaderboardCommand, handleSmartLeaderboard, init,
  isLeaderboardButton, handleLeaderboardButton,
};
