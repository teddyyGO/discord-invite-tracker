'use strict';

const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const { hasModeratorAccess } = require('../../core/permissions');
const storage = require('../../core/storage');
const rewards = require('../invites/rewards');

const addBonusCommand = new SlashCommandBuilder()
  .setName('addbonus')
  .setDescription('მომხმარებლისთვის ბონუს მოწვევების დამატება')
  .addUserOption(o => o.setName('user').setDescription('მომხმარებელი').setRequired(true))
  .addIntegerOption(o => o.setName('amount').setDescription('რაოდენობა (შეიძლება უარყოფითი)').setRequired(true));

const removeBonusCommand = new SlashCommandBuilder()
  .setName('removebonus')
  .setDescription('მომხმარებლისთვის ბონუს მოწვევების მოკლება')
  .addUserOption(o => o.setName('user').setDescription('მომხმარებელი').setRequired(true))
  .addIntegerOption(o => o.setName('amount').setDescription('რაოდენობა').setRequired(true));

async function handleBonus(interaction, config, sign) {
  if (!hasModeratorAccess(interaction.member, config)) {
    return interaction.reply({ content: 'ამის უფლება არ გაქვს.', flags: MessageFlags.Ephemeral });
  }

  const user   = interaction.options.getUser('user');
  const amount = interaction.options.getInteger('amount') * sign;

  const newAmount = await storage.addBonus(config.guildId, user.id, amount);

  // Reward roles may cross a threshold after a bonus change.
  if (interaction.guild) await rewards.sync(interaction.guild, user.id, config).catch(() => {});

  const stats = await storage.getInviterStats(config.guildId, user.id);
  const embed = new EmbedBuilder()
    .setColor(0x57F287)
    .setDescription(`🎁 <@${user.id}>-ის ბონუსი: **${newAmount}** (${amount >= 0 ? '+' : ''}${amount})\nსულ მოწვევები: **${stats.total}**`);

  await interaction.reply({ embeds: [embed] });
}

module.exports = {
  addBonusCommand, removeBonusCommand,
  handleAddBonus:    (i, c) => handleBonus(i, c, 1),
  handleRemoveBonus: (i, c) => handleBonus(i, c, -1),
};
