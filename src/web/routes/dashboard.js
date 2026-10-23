'use strict';

const { Router } = require('express');
const storage = require('../../core/storage');
const { dashboardPage } = require('../views');
const { resolveNames } = require('../util');
const logger = require('../../utils/logger');
const { requireAuth, requireModerator } = require('../middleware');

function createDashboardRouter(config, discordClient) {
  const router = Router();
  router.get('/', requireAuth, requireModerator, async (req, res) => {
    try {
      const [overview, top] = await Promise.all([
        storage.getOverview(config.guildId),
        storage.getLeaderboard(config.guildId, 5),
      ]);
      const names = discordClient ? await resolveNames(discordClient, top.map(t => t.inviterId)) : {};
      res.send(dashboardPage(req.session.user, overview, top, names));
    } catch (e) {
      logger.error('Web route error', { path: req.originalUrl, error: e.message });
      res.status(500).send('Internal server error');
    }
  });
  return router;
}

module.exports = { createDashboardRouter };
