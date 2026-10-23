'use strict';

const {
  SlashCommandBuilder, EmbedBuilder, MessageFlags, ChannelType, PermissionFlagsBits,
} = require('discord.js');
const storage = require('../../core/storage');
const logger  = require('../../utils/logger');

const createInviteCommand = new SlashCommandBuilder()
  .setName('createinvite')
  .setDescription('შექმენი შენი პირადი მოწვევის ლინკი (ვადის გარეშე)');

// Pick a text channel the bot can create invites in: prefer the requested one,
// then the system/rules channel, then any eligible text channel.
function pickInviteChannel(guild, preferred) {
  const me = guild.members.me;
  const canInvite = ch =>
    ch &&
    (ch.type === ChannelType.GuildText || ch.type === ChannelType.GuildAnnouncement) &&
    ch.permissionsFor(me)?.has(PermissionFlagsBits.CreateInstantInvite);

  if (canInvite(preferred))            return preferred;
  if (canInvite(guild.systemChannel))  return guild.systemChannel;
  if (canInvite(guild.rulesChannel))   return guild.rulesChannel;
  return guild.channels.cache.find(canInvite) ?? null;
}

// Return the player's existing personal invite if it still exists, otherwise
// create a new never-expiring, unlimited-use one and remember who owns it.
// Returns { url, code, created }. Throws 'NO_CHANNEL' / 'NO_PERMISSION' on failure.
async function getOrCreatePersonalInvite(guild, user, preferred) {
  const existing = await storage.getPersonalInviteByUser(guild.id, user.id).catch(() => null);
  if (existing) {
    try {
      const invites = await guild.invites.fetch();
      if (invites.has(existing)) {
        return { url: `https://discord.gg/${existing}`, code: existing, created: false };
      }
    } catch { /* can't verify — fall through and make a fresh one */ }
  }

  const channel = pickInviteChannel(guild, preferred);
  if (!channel) { const e = new Error('NO_CHANNEL'); e.code = 'NO_CHANNEL'; throw e; }

  let invite;
  try {
    invite = await channel.createInvite({
      maxAge: 0,        // never expires
      maxUses: 0,       // unlimited uses
      unique: true,     // a fresh code dedicated to this player
      reason: `Personal invite for ${user.tag} (${user.id})`,
    });
  } catch (e) {
    logger.warn('Failed to create personal invite', { userId: user.id, error: e.message, code: e.code });
    const err = new Error('NO_PERMISSION'); err.code = 'NO_PERMISSION'; throw err;
  }

  await storage.addPersonalInvite(guild.id, invite.code, user.id).catch(e =>
    logger.error('Failed to persist personal invite', { error: e.message }));

  return { url: `https://discord.gg/${invite.code}`, code: invite.code, created: true };
}

// Build the ephemeral reply shown for both /createinvite and the leaderboard button.
async function replyWithPersonalInvite(interaction, config) {
  if (!interaction.guild) {
    return interaction.editReply({ content: 'ეს მხოლოდ სერვერზე მუშაობს.' });
  }
  try {
    const { url, code, created } = await getOrCreatePersonalInvite(
      interaction.guild, interaction.user, interaction.channel,
    );

    const embed = new EmbedBuilder()
      .setColor(0x57F287)
      .setTitle('🔗 შენი პირადი მოწვევის ლინკი')
      .setDescription(
        `${url}\n\n` +
        (created ? '✨ ახალი ლინკი შეიქმნა.' : 'ℹ️ ეს შენი არსებული ლინკია.') +
        '\n♾️ ვადის გარეშე • შეუზღუდავი გამოყენება\n\n' +
        'ამ ლინკით შემოსული ყველა წევრი **შენ** ჩაგეთვლება.',
      )
      .setFooter({ text: `Invite code: ${code}` });

    return interaction.editReply({ embeds: [embed] });
  } catch (e) {
    const msg = e.code === 'NO_CHANNEL'
      ? '❌ ვერ ვიპოვე არხი, სადაც მოწვევის შექმნა შემიძლია.'
      : e.code === 'NO_PERMISSION'
        ? '❌ ბოტს არ აქვს **Create Invite** უფლება. მიმართე ადმინისტრატორს.'
        : '❌ ლინკის შექმნა ვერ მოხერხდა.';
    return interaction.editReply({ content: msg });
  }
}

async function handleCreateInvite(interaction, config) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  return replyWithPersonalInvite(interaction, config);
}

module.exports = {
  createInviteCommand, handleCreateInvite,
  getOrCreatePersonalInvite, replyWithPersonalInvite,
};
