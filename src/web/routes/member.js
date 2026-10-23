'use strict';

const { Router } = require('express');
const storage = require('../../core/storage');
const { memberPage } = require('../views');
const { resolveNames } = require('../util');
const logger = require('../../utils/logger');
const { requireAuth, requireModerator } = require('../middleware');

function createMembersRouter(config, discordClient) {
  const router = Router();
  router.get('/', requireAuth, requireModerator, async (req, res) => {
    const userId = (req.query.userId ?? '').trim();
    try {
      let data = null;
      let names = {};
      if (userId) {
        const [stats, invitedBy, list] = await Promise.all([
          storage.getInviterStats(config.guildId, userId),
          storage.getInvitedBy(config.guildId, userId),
          storage.getInvitedList(config.guildId, userId, 50),
        ]);
        data = { stats, invitedBy, list };
        if (discordClient) {
          const ids = [userId, invitedBy?.inviter_id, ...list.map(r => r.user_id)];
          names = await resolveNames(discordClient, ids);
        }
      }
      res.send(memberPage(req.session.user, userId, data, names));
    } catch (e) {
      logger.error('Web route error', { path: req.originalUrl, error: e.message });
      res.status(500).send('Internal server error');
    }
  });
  return router;
}

module.exports = { createMembersRouter };
