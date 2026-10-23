'use strict';

const logger = require('../utils/logger');

// Resolve a channel by id and send a payload to it. Used by the main log channel
// and by per-link tracked channels. Returns true on success, false otherwise.
async function sendToChannel(client, channelId, payload) {
  if (!channelId) return false;
  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel || typeof channel.send !== 'function') return false;
    await channel.send(payload);
    return true;
  } catch (e) {
    logger.warn('Failed to send to channel', { channelId, error: e.message, code: e.code });
    return false;
  }
}

// Send an embed to the configured guild log channel.
async function sendLog(guild, config, embed) {
  if (!config.logChannelId) return false;
  return sendToChannel(guild.client, config.logChannelId, { embeds: [embed] });
}

module.exports = { sendToChannel, sendLog };
