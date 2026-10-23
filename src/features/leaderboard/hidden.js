'use strict';

const { SlashCommandBuilder, EmbedBuilder, MessageFlags, PermissionFlagsBits } = require('discord.js');
const storage = require('../../core/storage');
const { hasModeratorAccess } = require('../../core/permissions');

const leaderboardHideCommand = new SlashCommandBuilder()
  .setName('leaderboardhide')
  .setDescription('დამალე/აღადგინე მომხმარებლები ან როლები ლიდერბორდიდან')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild.toString())
  .addSubcommandGroup(g => g.setName('user').setDescription('მომხმარებლის დამალვა/აღდგენა')
    .addSubcommand(s => s.setName('add').setDescription('დამალე მომხმარებელი ლიდერბორდიდან')
      .addUserOption(o => o.setName('user').setDescription('მომხმარებელი').setRequired(true)))
    .addSubcommand(s => s.setName('remove').setDescription('აღადგინე მომხმარებელი ლიდერბორდზე')
      .addUserOption(o => o.setName('user').setDescription('მომხმარებელი').setRequired(true))))
  .addSubcommandGroup(g => g.setName('role').setDescription('როლის დამალვა/აღდგენა')
    .addSubcommand(s => s.setName('add').setDescription('დამალე ამ როლის წევრები ლიდერბორდიდან')
      .addRoleOption(o => o.setName('role').setDescription('როლი').setRequired(true)))
    .addSubcommand(s => s.setName('remove').setDescription('აღადგინე ამ როლის წევრები')
      .addRoleOption(o => o.setName('role').setDescription('როლი').setRequired(true))))
  .addSubcommand(s => s.setName('list').setDescription('დამალული მომხმარებლების/როლების სია'));

async function handleLeaderboardHide(interaction, config) {
  if (!hasModeratorAccess(interaction.member, config)) {
    return interaction.reply({ content: 'ამის უფლება არ გაქვს.', flags: MessageFlags.Ephemeral });
  }

  const group = interaction.options.getSubcommandGroup(false);
  const sub   = interaction.options.getSubcommand();

  if (group === 'user') {
    const user = interaction.options.getUser('user');
    if (sub === 'add') {
      await storage.addHidden(config.guildId, 'user', user.id);
      return interaction.reply({ content: `🙈 <@${user.id}> დაიმალა ლიდერბორდიდან.`, flags: MessageFlags.Ephemeral });
    }
    const removed = await storage.removeHidden(config.guildId, 'user', user.id);
    return interaction.reply({
      content: removed ? `👁️ <@${user.id}> აღდგა ლიდერბორდზე.` : `<@${user.id}> დამალულებში არ იყო.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  if (group === 'role') {
    const role = interaction.options.getRole('role');
    if (sub === 'add') {
      await storage.addHidden(config.guildId, 'role', role.id);
      return interaction.reply({ content: `🙈 <@&${role.id}> როლის წევრები დაიმალა ლიდერბორდიდან.`, flags: MessageFlags.Ephemeral });
    }
    const removed = await storage.removeHidden(config.guildId, 'role', role.id);
    return interaction.reply({
      content: removed ? `👁️ <@&${role.id}> როლი აღდგა ლიდერბორდზე.` : `<@&${role.id}> დამალულებში არ იყო.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  // list
  const { users, roles } = await storage.getHidden(config.guildId);
  if (!users.length && !roles.length) {
    return interaction.reply({ content: 'ლიდერბორდიდან არავინ არის დამალული.', flags: MessageFlags.Ephemeral });
  }

  const embed = new EmbedBuilder()
    .setTitle('🙈 ლიდერბორდიდან დამალულები')
    .setColor(0x5865F2)
    .addFields(
      { name: `👤 მომხმარებლები (${users.length})`, value: users.length ? users.map(id => `<@${id}>`).join(', ').slice(0, 1024) : '—', inline: false },
      { name: `🎭 როლები (${roles.length})`,        value: roles.length ? roles.map(id => `<@&${id}>`).join(', ').slice(0, 1024) : '—', inline: false },
    );

  return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

module.exports = { leaderboardHideCommand, handleLeaderboardHide };
