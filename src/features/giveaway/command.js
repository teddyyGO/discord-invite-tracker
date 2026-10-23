'use strict';

const {
  SlashCommandBuilder, EmbedBuilder, MessageFlags, PermissionFlagsBits, ChannelType,
} = require('discord.js');
const { hasModeratorAccess } = require('../../core/permissions');
const storage = require('../../core/storage');
const engine  = require('./giveaway');

const giveawayCommand = new SlashCommandBuilder()
  .setName('giveaway')
  .setDescription('მოწვევებზე დაფუძნებული გათამაშებები')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild.toString())
  .addSubcommand(s => s.setName('start').setDescription('დაიწყე ახალი გათამაშება')
    .addStringOption(o => o.setName('prize').setDescription('პრიზი (მაგ: GTA 5)').setRequired(true))
    .addStringOption(o => o.setName('duration').setDescription('ხანგრძლივობა: 7d, 72h, 1w, 90m').setRequired(true))
    .addIntegerOption(o => o.setName('invites').setDescription('საჭირო ახალი მოწვევები').setRequired(true).setMinValue(1))
    .addChannelOption(o => o.setName('channel').setDescription('არხი (ნაგულისხმევი: მიმდინარე)').setRequired(false)
      .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)))
  .addSubcommand(s => s.setName('end').setDescription('დაასრულე ახლავე და აარჩიე გამარჯვებული')
    .addIntegerOption(o => o.setName('id').setDescription('გათამაშების ID').setRequired(true)))
  .addSubcommand(s => s.setName('reroll').setDescription('აირჩიე ახალი გამარჯვებული')
    .addIntegerOption(o => o.setName('id').setDescription('გათამაშების ID').setRequired(true)))
  .addSubcommand(s => s.setName('cancel').setDescription('გააუქმე გათამაშება გამარჯვებულის გარეშე')
    .addIntegerOption(o => o.setName('id').setDescription('გათამაშების ID').setRequired(true)))
  .addSubcommand(s => s.setName('list').setDescription('გათამაშებების სია'));

function reasonText(reason) {
  switch (reason) {
    case 'not_found':     return 'ასეთი ID ვერ მოიძებნა.';
    case 'not_active':    return 'ეს გათამაშება აქტიური არ არის.';
    case 'not_ended':     return 'reroll შესაძლებელია მხოლოდ დასრულებულ გათამაშებაზე.';
    case 'already_ended': return 'უკვე დასრულდა.';
    default:              return 'ვერ შესრულდა.';
  }
}

async function handleGiveaway(interaction, config) {
  if (!hasModeratorAccess(interaction.member, config)) {
    return interaction.reply({ content: 'ამის უფლება არ გაქვს.', flags: MessageFlags.Ephemeral });
  }

  const sub    = interaction.options.getSubcommand();
  const client = interaction.client;

  if (sub === 'start') {
    const prize      = interaction.options.getString('prize').trim();
    const required   = interaction.options.getInteger('invites');
    const channel    = interaction.options.getChannel('channel') ?? interaction.channel;
    const durationMs = engine.parseDuration(interaction.options.getString('duration'));

    if (!durationMs) {
      return interaction.reply({ content: 'ხანგრძლივობა არასწორია. გამოიყენე მაგ: `7d`, `72h`, `1w`, `90m`.', flags: MessageFlags.Ephemeral });
    }
    if (!channel || typeof channel.send !== 'function') {
      return interaction.reply({ content: 'არასწორი არხი.', flags: MessageFlags.Ephemeral });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      const { giveaway } = await engine.startGiveaway({ config, channel, prize, durationMs, requiredInvites: required });
      const end = Math.floor(new Date(giveaway.ends_at).getTime() / 1000);
      return interaction.editReply(
        `✅ გათამაშება **#${giveaway.id}** შეიქმნა <#${channel.id}>-ში.\n` +
        `პრიზი: **${prize}** • საჭირო მოწვევები: **${required}** • მთავრდება: <t:${end}:R>`,
      );
    } catch (e) {
      return interaction.editReply(`ვერ შეიქმნა (შეამოწმე ბოტს აქვს თუ არა ამ არხში წერის უფლება): ${e.message}`);
    }
  }

  if (sub === 'list') {
    const rows = await storage.listGiveaways(config.guildId, 10);
    if (!rows.length) return interaction.reply({ content: 'გათამაშებები ჯერ არ ყოფილა.', flags: MessageFlags.Ephemeral });
    const lines = rows.map(g => {
      const end = Math.floor(new Date(g.ends_at).getTime() / 1000);
      const st = g.status === 'active'
        ? `🟢 აქტიური — მთავრდება <t:${end}:R>`
        : g.status === 'ended'
          ? `🏁 დასრულდა${g.winner_id ? ` — 🏆 <@${g.winner_id}>` : ' — გამარჯვებულის გარეშე'}`
          : '❌ გაუქმდა';
      return `**#${g.id}** • **${g.prize}** • საჭ. მოწვევები: ${g.required_invites} • ${st}`;
    });
    const embed = new EmbedBuilder().setColor(0x5865F2).setTitle('🎉 გათამაშებები').setDescription(lines.join('\n'));
    return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  }

  // end / reroll / cancel — all take an id
  const id = interaction.options.getInteger('id');
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  if (sub === 'end') {
    const r = await engine.endNow(client, config, id);
    if (!r.ok) return interaction.editReply(reasonText(r.reason));
    return interaction.editReply(r.winnerId
      ? `🏁 გათამაშება #${id} დასრულდა. 🏆 გამარჯვებული: <@${r.winnerId}>`
      : `🏁 გათამაშება #${id} დასრულდა — მონაწილეები არ აღმოჩნდა.`);
  }

  if (sub === 'reroll') {
    const r = await engine.reroll(client, config, id);
    if (!r.ok) return interaction.editReply(reasonText(r.reason));
    return interaction.editReply(r.winnerId
      ? `🔁 ახალი გამარჯვებული #${id}: <@${r.winnerId}>`
      : `🔁 #${id}: მონაწილეები არ აღმოჩნდა.`);
  }

  if (sub === 'cancel') {
    const r = await engine.cancel(client, config, id);
    if (!r.ok) return interaction.editReply(reasonText(r.reason));
    return interaction.editReply(`❌ გათამაშება #${id} გაუქმდა.`);
  }
}

module.exports = {
  giveawayCommand, handleGiveaway,
  isGiveawayButton: engine.isGiveawayButton,
  handleGiveawayButton: engine.handleGiveawayButton,
};
