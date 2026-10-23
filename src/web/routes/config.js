'use strict';

const { Router } = require('express');
const storage = require('../../core/storage');
const { configPage } = require('../views');
const { resolveChannelNames } = require('../util');
const { applyGuildConfig } = require('../../config/loader');
const { resolvePermLevel } = require('./auth');
const logger = require('../../utils/logger');
const { requireAuth, requireAdmin } = require('../middleware');

function asArray(v) { return v == null ? [] : (Array.isArray(v) ? v : [v]); }

function buildCfgView(dbCfg, config) {
  return {
    guild_id:           dbCfg.guild_id ?? config.guildId,
    moderator_role_ids: dbCfg.moderator_role_ids ?? config.moderatorRoleIds,
    log_channel_id:     dbCfg.log_channel_id ?? config.logChannelId,
    fake_min_age_days:  dbCfg.fake_min_age_days ?? config.fakeMinAgeDays,
    count_bots:         dbCfg.count_bots ?? config.countBots,
    reward_roles:       dbCfg.reward_roles ?? config.rewardRoles,
  };
}

function createConfigRouter(config, discordClient) {
  const router = Router();

  router.get('/', requireAuth, requireAdmin, async (req, res) => {
    try {
      const dbCfg = (await storage.getGuildConfig(config.guildId)) ?? {};
      const cfg   = buildCfgView(dbCfg, config);
      const channelNames = discordClient ? await resolveChannelNames(discordClient, [cfg.log_channel_id]) : {};
      res.send(configPage(req.session.user, cfg, channelNames, req.query.saved === '1', null));
    } catch (e) {
      logger.error('Web route error', { path: req.originalUrl, error: e.message });
      res.status(500).send('Internal server error');
    }
  });

  router.post('/', requireAuth, requireAdmin, async (req, res) => {
    try {
      const SNOWFLAKE = /^\d{17,20}$/;
      const roleIds = String(req.body.moderator_role_ids ?? '')
        .split(',').map(s => s.trim()).filter(Boolean);
      const guildId      = String(req.body.guild_id ?? '').trim() || config.guildId;
      const logChannelId = String(req.body.log_channel_id ?? '').trim();
      if (!SNOWFLAKE.test(guildId) || (logChannelId && !SNOWFLAKE.test(logChannelId)) || !roleIds.every(r => SNOWFLAKE.test(r))) {
        throw Object.assign(new Error('IDs must be numeric Discord IDs.'), { userFacing: true });
      }
      // Switching guilds hands this panel control of another server — require admin there too.
      if (guildId !== config.guildId && (await resolvePermLevel(discordClient, { ...config, guildId }, req.session.user.id)) < 2) {
        throw Object.assign(new Error('You must be an administrator of the target server.'), { userFacing: true });
      }

      const invites = asArray(req.body.rewardInvites);
      const roles   = asArray(req.body.rewardRole);
      const rewardRoles = [];
      for (let i = 0; i < Math.min(invites.length, roles.length); i++) {
        const threshold = parseInt(invites[i], 10);
        const roleId    = String(roles[i] ?? '').trim();
        if (Number.isFinite(threshold) && threshold > 0 && /^\d{17,20}$/.test(roleId)) {
          rewardRoles.push({ invites: threshold, role_id: roleId });
        }
      }

      const value = {
        guild_id:           guildId,
        moderator_role_ids: roleIds,
        log_channel_id:     logChannelId,
        fake_min_age_days:  Math.max(0, parseInt(req.body.fake_min_age_days, 10) || 0),
        count_bots:         req.body.count_bots === '1',
        reward_roles:       rewardRoles,
      };

      await storage.saveGuildConfig(value.guild_id, value);
      applyGuildConfig(config, value);
      res.redirect('/config?saved=1');
    } catch (e) {
      if (!e.userFacing) logger.error('Config save failed', { error: e.message });
      const dbCfg = (await storage.getGuildConfig(config.guildId).catch(() => ({}))) ?? {};
      res.status(500).send(configPage(req.session.user, buildCfgView(dbCfg, config), {}, false, e.userFacing ? e.message : 'Failed to save configuration.'));
    }
  });

  return router;
}

module.exports = { createConfigRouter };
