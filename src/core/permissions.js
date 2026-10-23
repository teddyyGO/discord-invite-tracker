'use strict';

const { PermissionFlagsBits } = require('discord.js');

// Bot owners (full access everywhere), from env: OWNER_IDS=id1,id2
const OWNER_IDS = new Set((process.env.OWNER_IDS ?? '').split(',').map(s => s.trim()).filter(Boolean));

function isOwner(userId) {
  return OWNER_IDS.has(userId);
}

// Full admin: owner OR Discord Administrator permission.
function hasAdminAccess(member) {
  return isOwner(member.id) || member.permissions.has(PermissionFlagsBits.Administrator);
}

// Moderator: owner, Discord admin, OR a configured moderator role.
function hasModeratorAccess(member, config) {
  if (isOwner(member.id)) return true;
  if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
  const roleIds = config.moderatorRoleIds;
  if (!Array.isArray(roleIds) || !roleIds.length) return false;
  return roleIds.some(id => member.roles.cache.has(id));
}

module.exports = { OWNER_IDS, isOwner, hasAdminAccess, hasModeratorAccess };
