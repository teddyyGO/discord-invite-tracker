'use strict';

const express  = require('express');
const session  = require('express-session');
const PgSessionStore = require('./sessionStore');
const { loginPage }  = require('./views');
const { createAuthRouter, resolvePermLevel } = require('./routes/auth');
const { createDashboardRouter }   = require('./routes/dashboard');
const { createLeaderboardRouter } = require('./routes/leaderboard');
const { createMembersRouter }     = require('./routes/member');
const { createLinksRouter }       = require('./routes/links');
const { createLogsRouter }        = require('./routes/logs');
const { createConfigRouter }      = require('./routes/config');
const logger = require('../utils/logger');

const ERR = {
  cancelled:      'Discord authorization was cancelled.',
  state_mismatch: 'Security error. Please try again.',
  no_access:      'Access denied — you need Administrator or a moderator role on the server.',
  auth_failed:    'Authorization failed. Please try again.',
};

// Never fall back to a known default: without SESSION_SECRET use a random
// per-process secret (sessions just won't survive a restart).
function sessionSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  logger.warn('SESSION_SECRET not set — using a random secret; web sessions reset on restart');
  return require('crypto').randomBytes(32).toString('hex');
}

function createWebServer(config, discordClient) {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.set({ 'X-Frame-Options': 'DENY', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin' });
    next();
  });
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));
  app.use(express.json());

  app.use(session({
    store:             new PgSessionStore(),
    secret:            sessionSecret(),
    resave:            false,
    saveUninitialized: false,
    name:              'invite.sid',
    cookie: {
      secure:   process.env.WEB_URL?.startsWith('https://') ?? false,
      httpOnly: true,
      maxAge:   7 * 24 * 60 * 60 * 1000,
      sameSite: 'lax',
    },
  }));

  // Re-verify panel access every few minutes so a removed admin/mod loses access
  // without waiting for the 7-day session to expire.
  app.use(async (req, res, next) => {
    const u = req.session?.user;
    if (!u || Date.now() - (u.checkedAt ?? 0) < 5 * 60 * 1000) return next();
    const level = await resolvePermLevel(discordClient, config, u.id).catch(() => 0);
    if (level === 0) return req.session.destroy(() => res.redirect('/login?error=no_access'));
    u.permLevel = level;
    u.checkedAt = Date.now();
    next();
  });

  app.use('/auth', createAuthRouter(config, discordClient));

  app.get('/login', (req, res) => {
    if (req.session.user) return res.redirect('/dashboard');
    res.send(loginPage(ERR[req.query.error] ?? ''));
  });

  app.get('/', (req, res) => res.redirect(req.session?.user ? '/dashboard' : '/login'));

  app.use('/dashboard',   createDashboardRouter(config, discordClient));
  app.use('/leaderboard', createLeaderboardRouter(config, discordClient));
  app.use('/members',     createMembersRouter(config, discordClient));
  app.use('/links',       createLinksRouter(config, discordClient));
  app.use('/logs',        createLogsRouter(config, discordClient));
  app.use('/config',      createConfigRouter(config, discordClient));

  app.use((req, res) => res.redirect('/dashboard'));
  return app;
}

function startWebServer(config, discordClient) {
  const port = parseInt(process.env.PORT ?? '3000', 10);
  createWebServer(config, discordClient).listen(port, '0.0.0.0', () => {
    logger.info(`Web panel listening on port ${port}`);
  });
}

module.exports = { createWebServer, startWebServer };
