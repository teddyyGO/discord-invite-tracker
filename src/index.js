'use strict';

const { Client, GatewayIntentBits, Partials, REST, Routes } = require('discord.js');
const path = require('path');
const fs   = require('fs');

const { loadConfig, applyGuildConfig } = require('./config/loader');
const logger      = require('./utils/logger');
const storage     = require('./core/storage');
const inviteCache = require('./core/inviteCache');
const { startWebServer } = require('./web/server');

const {
  invitesCommand, leaderboardCommand, invitedByCommand, invitedListCommand,
} = require('./features/invites/command');
const { addBonusCommand, removeBonusCommand } = require('./features/bonus/command');
const { smartLeaderboardCommand, init: initSmartLeaderboard } = require('./features/leaderboard/smart');
const { leaderboardHideCommand } = require('./features/leaderboard/hidden');
const { createInviteCommand } = require('./features/invites/personal');
const { reassignCommand } = require('./features/invites/reassign');
const { giveawayCommand } = require('./features/giveaway/command');
const giveaway = require('./features/giveaway/giveaway');
const {
  trackInviteCommand, untrackInviteCommand, trackedLinksCommand,
} = require('./features/tracking/command');

const config = loadConfig();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,   // Privileged — join/leave attribution
    GatewayIntentBits.GuildInvites,   // invite create/delete + read invites
  ],
  partials: [Partials.GuildMember],
});

// ── Event loader ────────────────────────────────────────────────────────────
const eventsDir = path.join(__dirname, 'events');
for (const file of fs.readdirSync(eventsDir).filter(f => f.endsWith('.js'))) {
  const event = require(path.join(eventsDir, file));
  client.on(event.name, (...args) => event.execute(...args, config));
}

client.once('ready', async () => {
  logger.info(`Logged in as ${client.user.tag}`);

  try {
    await storage.init(config.databaseUrl);
    const dbCfg = await storage.getGuildConfig(config.guildId);
    if (dbCfg) { applyGuildConfig(config, dbCfg); logger.info('Guild config applied from DB'); }
  } catch (e) {
    logger.error('Database init failed — exiting', { error: e.message });
    process.exit(1);
  }

  // Seed invite snapshot for the configured guild (and any others the bot is in).
  for (const guild of client.guilds.cache.values()) {
    await inviteCache.sync(guild).catch(() => {});
  }
  logger.info('Invite cache seeded');

  startWebServer(config, client);
  await registerCommands();

  // Resume the pinned, self-refreshing leaderboard if one was set up earlier.
  await initSmartLeaderboard(client, config).catch(e =>
    logger.warn('Smart leaderboard init failed', { error: e.message }));

  // Resume giveaways: refresh live counts and finish any whose timer elapsed offline.
  await giveaway.init(client, config).catch(e =>
    logger.warn('Giveaway init failed', { error: e.message }));
});

async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(config.token);
  const body = [
    invitesCommand, leaderboardCommand, invitedByCommand, invitedListCommand,
    addBonusCommand, removeBonusCommand,
    smartLeaderboardCommand, leaderboardHideCommand, createInviteCommand, reassignCommand,
    giveawayCommand,
    trackInviteCommand, untrackInviteCommand, trackedLinksCommand,
  ].map(c => c.toJSON());

  for (const guildId of client.guilds.cache.keys()) {
    try {
      await rest.put(Routes.applicationGuildCommands(client.user.id, guildId), { body });
      logger.info(`Slash commands registered in guild ${guildId}`);
    } catch (e) {
      logger.error(`Failed to register commands in guild ${guildId}`, { error: e.message });
    }
  }
}

process.on('unhandledRejection', e => logger.error('Unhandled rejection', { error: e?.message }));
process.on('SIGTERM', () => { logger.info('SIGTERM — shutting down'); client.destroy(); process.exit(0); });

client.login(config.token);
