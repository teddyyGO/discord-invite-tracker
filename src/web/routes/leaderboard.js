'use strict';

const { Router } = require('express');
const storage = require('../../core/storage');
const { leaderboardPage } = require('../views');
const { resolveNames } = require('../util');
const logger = require('../../utils/logger');
const { requireAuth, requireModerator } = require('../middleware');

function createLeaderboardRouter(config, discordClient) {
  const router = Router();
  router.get('/', requireAuth, requireModerator, async (req, res) => {
    try {
      const rows  = await storage.getLeaderboard(config.guildId, 50);
      const names = discordClient ? await resolveNames(discordClient, rows.map(r => r.inviterId)) : {};
      res.send(leaderboardPage(req.session.user, rows, names));
    } catch (e) {
      logger.error('Web route error', { path: req.originalUrl, error: e.message });
      res.status(500).send('Internal server error');
    }
  });
  return router;
}

module.exports = { createLeaderboardRouter };
