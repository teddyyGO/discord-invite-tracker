'use strict';

const inviteCache = require('../core/inviteCache');
const logger = require('../utils/logger');

module.exports = {
  name: 'guildCreate',
  async execute(guild, config) {
    if (guild.id !== config.guildId) return;
    logger.info(`Joined guild ${guild.name} — seeding invite cache`);
    await inviteCache.sync(guild).catch(() => {});
  },
};
