'use strict';

const { SlashCommandBuilder, EmbedBuilder, MessageFlags, PermissionFlagsBits } = require('discord.js');
const { hasModeratorAccess } = require('../../core/permissions');
const storage = require('../../core/storage');
const rewards = require('./rewards');

// Manual correction for joins the tracker logged as Unknown (e.g. a personal
// link whose use-count lagged): credit the real inviter as a REAL invite, not a
// 🎁 bonus. Rewrites the member's most-recent join row.
const reassignCommand = new SlashCommandBuilder()
  .setName('reassign')
  .setDescription('მიაკუთვნე წევრის შემოსვლა ნამდვილ მომწვევს (ნამდვილ მოწვევად, არა ბონუსად)')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild.toString())
  .addUserOption(o => o.setName('member').setDescription('ვინც შემოვიდა').setRequired(true))
  .addUserOption(o => o.setName('inviter').setDescription('ნამდვილი მომწვევი').setRequired(true))
  .addStringOption(o => o.setName('code').setDescription('მოწვევის კოდი (არასავალდებულო)').setRequired(false));

async function handleReassign(interaction, config) {
  if (!hasModeratorAccess(interaction.member, config)) {
    return interaction.reply({ content: 'ამის უფლება არ გაქვს.', flags: MessageFlags.Ephemeral });
  }

  const member  = interaction.options.getUser('member');
  const inviter = interaction.options.getUser('inviter');
  const code    = (interaction.options.getString('code') ?? '').trim() || null;

  if (inviter.id === member.id) {
    return interaction.reply({ content: 'მომწვევი და წევრი ერთი და იგივე ვერ იქნება.', flags: MessageFlags.Ephemeral });
  }

  const { updated, oldInviter, left } =
    await storage.reassignJoin(config.guildId, member.id, inviter.id, code);

  if (!updated) {
    return interaction.reply({
      content: `<@${member.id}>-ის შემოსვლის ჩანაწერი ვერ მოიძებნა.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  // Re-sync reward roles for the new inviter (gained one) and the old one (if any).
  if (interaction.guild) {
    await rewards.sync(interaction.guild, inviter.id, config).catch(() => {});
    if (oldInviter && oldInviter !== inviter.id) {
      await rewards.sync(interaction.guild, oldInviter, config).catch(() => {});
    }
  }

  const stats = await storage.getInviterStats(config.guildId, inviter.id);
  const note  = left ? '\n⚠️ ეს წევრი უკვე გასულია — ჩაითვალა, მაგრამ როგორც გასული (⬅️).' : '';
  const from  = oldInviter ? `<@${oldInviter}>` : '❓ Unknown';

  const embed = new EmbedBuilder()
    .setColor(0x57F287)
    .setDescription(
      `✅ <@${member.id}>-ის შემოსვლა მიეკუთვნა <@${inviter.id}>-ს ნამდვილ მოწვევად ` +
      `(${from} → <@${inviter.id}>${code ? `, კოდი \`${code}\`` : ''}).\n` +
      `<@${inviter.id}>-ის ჯამი ახლა: **${stats.total}** — ✅${stats.regular} ⬅️${stats.leaves} ⚠️${stats.fake} 🎁${stats.bonus}${note}`,
    );

  await interaction.reply({ embeds: [embed] });
}

module.exports = { reassignCommand, handleReassign };
