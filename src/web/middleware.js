'use strict';

const { accessDeniedPage } = require('./views');

function requireAuth(req, res, next) {
  if (req.session?.user) return next();
  req.session.returnTo = req.originalUrl;
  res.redirect('/login');
}

function requireModerator(req, res, next) {
  if (req.session?.user?.permLevel >= 1) return next();
  res.status(403).send(accessDeniedPage());
}

function requireAdmin(req, res, next) {
  if (req.session?.user?.permLevel >= 2) return next();
  res.status(403).send(accessDeniedPage());
}

module.exports = { requireAuth, requireModerator, requireAdmin };
