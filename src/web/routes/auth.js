'use strict';

const { Router } = require('express');
const { PermissionFlagsBits } = require('discord.js');
const crypto = require('crypto');
const { getOAuthUrl, exchangeCode, getUserInfo } = require('../auth');
const { loginPage } = require('../views');
const { OWNER_IDS } = require('../../core/permissions');
const logger = require('../../utils/logger');

const ERR = {
  cancelled:      'Discord authorization was cancelled.',
  state_mismatch: 'Security error. Please try again.',
  no_access:      'Access denied — you need Administrator or a moderator role on the server.',
  auth_failed:    'Authorization failed. Please try again.',
  not_configured: 'Discord OAuth is not configured.',
};

// 2 = admin (owner or Discord Administrator), 1 = configured moderator role, 0 = no access.
async function resolvePermLevel(discordClient, config, userId) {
  if (OWNER_IDS.has(userId)) return 2;
  if (!discordClient || !config.guildId) return 0;
  try {
    const guild  = discordClient.guilds.cache.get(config.guildId) ?? await discordClient.guilds.fetch(config.guildId);
    const member = await guild.members.fetch(userId);
    if (member.permissions.has(PermissionFlagsBits.Administrator)) return 2;
    if (Array.isArray(config.moderatorRoleIds) && config.moderatorRoleIds.some(r => member.roles.cache.has(r))) return 1;
    logger.warn('Web access denied — no admin/mod access', { userId, guildId: config.guildId });
  } catch (e) {
    logger.error('Web access could not resolve guild membership', { userId, guildId: config.guildId, error: e.message });
  }
  return 0;
}

function createAuthRouter(config, discordClient) {
  const router = Router();

  router.get('/discord', (req, res) => {
    if (!process.env.DISCORD_CLIENT_ID || !process.env.DISCORD_CLIENT_SECRET) {
      return res.send(loginPage(ERR.not_configured));
    }
    const state = crypto.randomBytes(16).toString('hex');
    req.session.oauthState = state;
    res.redirect(getOAuthUrl(state));
  });

  router.get('/callback', async (req, res) => {
    const { code, state, error } = req.query;
    if (error || !code) return res.redirect('/login?error=cancelled');
    const expected = req.session.oauthState;
    delete req.session.oauthState;
    // Reject when either side is missing (undefined === undefined would pass) and compare in constant time.
    if (typeof state !== 'string' || !expected || state.length !== expected.length ||
        !crypto.timingSafeEqual(Buffer.from(state), Buffer.from(expected))) {
      return res.redirect('/login?error=state_mismatch');
    }

    try {
      const tokens      = await exchangeCode(code);
      const discordUser = await getUserInfo(tokens.access_token);

      const permLevel = await resolvePermLevel(discordClient, config, discordUser.id);

      if (permLevel === 0) return res.redirect('/login?error=no_access');

      // New session ID on privilege change (prevents session fixation). Only same-origin paths for returnTo.
      const rt = req.session.returnTo;
      const returnTo = typeof rt === 'string' && rt.startsWith('/') && !rt.startsWith('//') && !rt.startsWith('/\\') ? rt : '/dashboard';
      req.session.regenerate(err => {
        if (err) { logger.error('Session regenerate failed', { error: err.message }); return res.redirect('/login?error=auth_failed'); }
        req.session.user = { id: discordUser.id, username: discordUser.username, permLevel, checkedAt: Date.now() };
        res.redirect(returnTo);
      });
    } catch (e) {
      logger.error('OAuth callback error', { error: e.message });
      res.redirect('/login?error=auth_failed');
    }
  });

  router.get('/logout', (req, res) => { req.session.destroy(() => res.redirect('/login')); });

  return router;
}

module.exports = { createAuthRouter, resolvePermLevel, ERR };
