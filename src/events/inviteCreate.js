'use strict';

const { EmbedBuilder } = require('discord.js');
const inviteCache = require('../core/inviteCache');
const { sendLog } = require('../core/logChannel');
const logger = require('../utils/logger');

module.exports = {
  name: 'inviteCreate',
  async execute(invite, config) {
    if (invite.guild?.id !== config.guildId) return;

    // Keep the snapshot current so the new code is known before anyone uses it.
    await inviteCache.sync(invite.guild).catch(() => {});

    if (!config.logChannelId) return;

    try {
      const inviter = invite.inviter;
      const inviterLine = inviter
        ? `**${inviter.globalName || inviter.username}** (@${inviter.username})\n<@${inviter.id}> • \`${inviter.id}\``
        : '❓ უცნობი (bot / OAuth / integration)';

      const maxUses = invite.maxUses ? `${invite.maxUses}` : '∞ (შეუზღუდავი)';
      const expires = invite.expiresTimestamp
        ? `<t:${Math.floor(invite.expiresTimestamp / 1000)}:R>`
        : 'არასდროს';

      const fields = [
        { name: '🔗 კოდი', value: `\`${invite.code}\``, inline: true },
        { name: '📂 არხი', value: invite.channelId ? `<#${invite.channelId}>` : '—', inline: true },
        { name: '👤 შემქმნელი', value: inviterLine, inline: false },
        { name: '🔢 მაქს. გამოყენება', value: maxUses, inline: true },
        { name: '⏳ ვადა', value: expires, inline: true },
      ];
      if (invite.temporary) fields.push({ name: '⚠️ დროებითი წევრობა', value: 'კი (temporary)', inline: true });

      const embed = new EmbedBuilder()
        .setTitle('➕ ახალი მოწვევის ლინკი შეიქმნა')
        .setColor(0x5865F2)
        .addFields(fields)
        .setFooter({ text: `Invite code: ${invite.code}` })
        .setTimestamp();

      await sendLog(invite.guild, config, embed);
    } catch (e) {
      logger.warn('Failed to log invite creation', { error: e.message });
    }
  },
};
