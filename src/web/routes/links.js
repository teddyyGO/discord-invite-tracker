'use strict';

const { Router } = require('express');
const storage = require('../../core/storage');
const { linksPage } = require('../views');
const { resolveNames } = require('../util');
const logger = require('../../utils/logger');
const { requireAuth, requireModerator } = require('../middleware');

function createLinksRouter(config, discordClient) {
  const router = Router();
  router.get('/', requireAuth, requireModerator, async (req, res) => {
    const code = (req.query.code ?? '').trim();
    try {
      const links = await storage.listPersonalLinks(config.guildId);
      let lookup = null;
      if (code) {
        lookup = links.find(l => l.code.toLowerCase() === code.toLowerCase()) ?? { code, notFound: true };
      }
      const names = discordClient ? await resolveNames(discordClient, links.map(l => l.userId)) : {};
      res.send(linksPage(req.session.user, code, lookup, links, names));
    } catch (e) {
      logger.error('Web route error', { path: req.originalUrl, error: e.message });
      res.status(500).send('Internal server error');
    }
  });
  return router;
}

module.exports = { createLinksRouter };
