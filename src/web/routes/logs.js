'use strict';

const { Router } = require('express');
const storage = require('../../core/storage');
const { logsPage } = require('../views');
const { resolveNames } = require('../util');
const logger = require('../../utils/logger');
const { requireAuth, requireModerator } = require('../middleware');

function createLogsRouter(config, discordClient) {
  const router = Router();
  router.get('/', requireAuth, requireModerator, async (req, res) => {
    try {
      const rows  = await storage.getRecentJoins(config.guildId, 100);
      const ids   = rows.flatMap(r => [r.user_id, r.inviter_id]);
      const names = discordClient ? await resolveNames(discordClient, ids) : {};
      res.send(logsPage(req.session.user, rows, names));
    } catch (e) {
      logger.error('Web route error', { path: req.originalUrl, error: e.message });
      res.status(500).send('Internal server error');
    }
  });
  return router;
}

module.exports = { createLogsRouter };
