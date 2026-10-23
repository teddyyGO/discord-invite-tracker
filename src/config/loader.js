'use strict';

require('dotenv').config();
const path = require('path');
const fs   = require('fs');

const REQUIRED_ENV = ['BOT_TOKEN', 'DATABASE_URL'];

function loadConfig() {
  const missing = REQUIRED_ENV.filter(k => !process.env[k]);
  if (missing.length) {
    console.error(`❌ [invite-bot] cannot start — missing env vars: ${missing.join(', ')}`);
    process.exit(1);
  }

  const configPath = path.join(__dirname, 'config.json');
  let file;
  try {
    file = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (e) {
    console.error(`❌ [invite-bot] cannot start — failed to parse config.json: ${e.message}`);
    process.exit(1);
  }

  const guildId = process.env.GUILD_ID || file.guild_id;
  if (!guildId) {
    console.error('❌ [invite-bot] cannot start — set GUILD_ID (env) or guild_id in config.json');
    process.exit(1);
  }

  return {
    token:            process.env.BOT_TOKEN,
    databaseUrl:      process.env.DATABASE_URL,
    guildId,
    moderatorRoleIds: Array.isArray(file.moderator_role_ids) ? file.moderator_role_ids : [],
    logChannelId:     file.log_channel_id || '',
    fakeMinAgeDays:   Number.isFinite(file.fake_min_age_days) ? file.fake_min_age_days : 7,
    countBots:        !!file.count_bots,
    rewardRoles:      Array.isArray(file.reward_roles) ? file.reward_roles : [],
  };
}

// Merge a stored guild-config blob (from the DB / web panel) into live config.
function applyGuildConfig(config, db) {
  if (!db) return;
  if (db.guild_id)                         config.guildId          = db.guild_id;
  if (Array.isArray(db.moderator_role_ids)) config.moderatorRoleIds = db.moderator_role_ids;
  if (db.log_channel_id !== undefined)     config.logChannelId     = db.log_channel_id;
  if (Number.isFinite(db.fake_min_age_days)) config.fakeMinAgeDays = db.fake_min_age_days;
  if (db.count_bots !== undefined)         config.countBots        = !!db.count_bots;
  if (Array.isArray(db.reward_roles))      config.rewardRoles      = db.reward_roles;
}

module.exports = { loadConfig, applyGuildConfig };
