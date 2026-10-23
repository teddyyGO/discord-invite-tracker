'use strict';

const inviteCache = require('../core/inviteCache');
const storage     = require('../core/storage');

module.exports = {
  name: 'inviteDelete',
  async execute(invite, config) {
    if (invite.guild?.id !== config.guildId) return;
    // Re-snapshot so a deleted code can't be mistaken for "used" on the next join.
    await inviteCache.sync(invite.guild).catch(() => {});
    // Drop any personal-invite mapping for the deleted code so we don't hand a
    // player a dead link; a fresh one is made on their next request.
    if (invite.code) await storage.deletePersonalInvite(config.guildId, invite.code).catch(() => {});
  },
};
