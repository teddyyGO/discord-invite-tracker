'use strict';

const { handleLeave } = require('../features/invites/attribution');
const logger = require('../utils/logger');

module.exports = {
  name: 'guildMemberRemove',
  async execute(member, config) {
    if (member.guild.id !== config.guildId) return;
    try {
      await handleLeave(member, config);
    } catch (e) {
      logger.error('guildMemberRemove handler error', { error: e.message });
    }
  },
};
