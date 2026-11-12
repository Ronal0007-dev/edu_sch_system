const { ActivityLog } = require("../models");

async function recordActivity(activity) {
  try {
    await ActivityLog.create(activity);
  } catch (err) {
    console.error("Unable to record activity log:", err.message);
  }
}

async function pruneExpiredActivityLogs(now = new Date()) {
  const cutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  return ActivityLog.destroy({
    where: {
      createdAt: { $lt: cutoff },
    },
  });
}

module.exports = {
  recordActivity,
  pruneExpiredActivityLogs,
};
