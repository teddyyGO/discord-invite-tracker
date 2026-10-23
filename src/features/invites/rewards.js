'use strict';

const logger = require('../../utils/logger');
const storage = require('../../core/storage');

// Add/remove reward roles for an inviter based on their current total invites.
// config.rewardRoles = [{ invites: <threshold>, role_id: '<id>' }, …]
async function sync(guild, inviterId, config) {
  if (!inviterId) return;
  const rewards = config.rewardRoles;
  if (!Array.isArray(rewards) || rewards.length === 0) return;

  const stats = await storage.getInviterStats(guild.id, inviterId).catch(() => null);
  if (!stats) return;
  const total = stats.total;

  let member;
  try {
    member = await guild.members.fetch(inviterId);
  } catch {
    return; // inviter not in the guild anymore
  }

  for (const r of rewards) {
    const roleId = r.role_id;
    const threshold = Number(r.invites);
    if (!roleId || !Number.isFinite(threshold)) continue;

    const has = member.roles.cache.has(roleId);
    try {
      if (total >= threshold && !has) {
        await member.roles.add(roleId);
        logger.info(`Reward role added`, { inviterId, roleId, total, threshold });
      } else if (total < threshold && has) {
        await member.roles.remove(roleId);
        logger.info(`Reward role removed`, { inviterId, roleId, total, threshold });
      }
    } catch (e) {
      logger.warn('Failed to sync reward role', { inviterId, roleId, code: e.code, error: e.message });
    }
  }
}

module.exports = { sync };
