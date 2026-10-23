'use strict';

const { handleJoin } = require('../features/invites/attribution');
const logger = require('../utils/logger');

module.exports = {
  name: 'guildMemberAdd',
  async execute(member, config) {
    if (member.guild.id !== config.guildId) return;
    try {
      await handleJoin(member, config);
    } catch (e) {
      logger.error('guildMemberAdd handler error', { error: e.message });
    }
  },
};
