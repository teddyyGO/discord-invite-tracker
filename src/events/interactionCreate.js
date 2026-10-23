'use strict';

const { MessageFlags } = require('discord.js');
const logger = require('../utils/logger');
const {
  handleInvites, handleLeaderboard, handleInvitedBy, handleInvitedList,
} = require('../features/invites/command');
const { handleAddBonus, handleRemoveBonus } = require('../features/bonus/command');
const {
  handleSmartLeaderboard, isLeaderboardButton, handleLeaderboardButton,
} = require('../features/leaderboard/smart');
const { handleLeaderboardHide } = require('../features/leaderboard/hidden');
const { handleCreateInvite } = require('../features/invites/personal');
const { handleReassign } = require('../features/invites/reassign');
const { handleGiveaway, isGiveawayButton, handleGiveawayButton } = require('../features/giveaway/command');
const {
  handleTrackInvite, handleUntrackInvite, handleTrackedLinks,
} = require('../features/tracking/command');

module.exports = {
  name: 'interactionCreate',
  async execute(interaction, config) {
    if (interaction.guildId && interaction.guildId !== config.guildId) return;

    // Button clicks (smart leaderboard + giveaway participation).
    if (interaction.isButton()) {
      try {
        if (isLeaderboardButton(interaction.customId)) return await handleLeaderboardButton(interaction, config);
        if (isGiveawayButton(interaction.customId))    return await handleGiveawayButton(interaction, config);
        return;
      } catch (e) {
        logger.error('button handler error', { customId: interaction.customId, error: e.message });
        const reply = { content: 'მოულოდნელი შეცდომა მოხდა.', flags: MessageFlags.Ephemeral };
        if (!interaction.replied && !interaction.deferred) await interaction.reply(reply).catch(() => {});
        else await interaction.editReply(reply).catch(() => {});
        return;
      }
    }

    if (!interaction.isChatInputCommand()) return;

    try {
      switch (interaction.commandName) {
        case 'invites':       return await handleInvites(interaction, config);
        case 'leaderboard':   return await handleLeaderboard(interaction, config);
        case 'invited-by':    return await handleInvitedBy(interaction, config);
        case 'invited-list':  return await handleInvitedList(interaction, config);
        case 'addbonus':      return await handleAddBonus(interaction, config);
        case 'removebonus':   return await handleRemoveBonus(interaction, config);
        case 'smartleaderboard': return await handleSmartLeaderboard(interaction, config);
        case 'leaderboardhide':  return await handleLeaderboardHide(interaction, config);
        case 'createinvite':  return await handleCreateInvite(interaction, config);
        case 'reassign':      return await handleReassign(interaction, config);
        case 'giveaway':      return await handleGiveaway(interaction, config);
        case 'trackinvite':   return await handleTrackInvite(interaction, config);
        case 'untrackinvite': return await handleUntrackInvite(interaction, config);
        case 'trackedlinks':  return await handleTrackedLinks(interaction, config);
      }
    } catch (e) {
      logger.error('interactionCreate error', { command: interaction.commandName, error: e.message });
      const reply = { content: 'მოულოდნელი შეცდომა მოხდა.', flags: MessageFlags.Ephemeral };
      if (!interaction.replied && !interaction.deferred) await interaction.reply(reply).catch(() => {});
      else if (interaction.deferred) await interaction.editReply(reply).catch(() => {});
    }
  },
};
