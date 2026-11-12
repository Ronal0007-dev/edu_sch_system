'use strict';
const cron = require('node-cron');
const { runBackup } = require('./backup');
const { pruneExpiredActivityLogs } = require('./activityLog');

/**
 * Schedule automatic database backup every 7 days.
 * Runs at 02:00 AM every Sunday (which is every 7 days effectively).
 * Cron: '0 2 * * 0'  →  minute=0, hour=2, any day-of-month, any month, Sunday(0)
 *
 * For true every-7-days regardless of day: use 0 2 every7days
 * We use Sunday 2 AM so backups are predictable and won't affect school hours.
 */
function startScheduler() {
  console.log('📅 Backup scheduler started — runs every Sunday at 02:00 AM');

  cron.schedule('0 2 * * 0', async () => {
    console.log('⏰ Weekly backup triggered by scheduler');
    await runBackup(false);
  }, {
    timezone: 'Africa/Dar_es_Salaam'  // Tanzania timezone — change to your server timezone
  });

  cron.schedule('10 2 * * *', async () => {
    try {
      const deleted = await pruneExpiredActivityLogs();
      console.log(`🧹 Removed ${deleted} activity log(s) older than seven days`);
    } catch (err) {
      console.error('Unable to prune expired activity logs:', err);
    }
  }, {
    timezone: 'Africa/Dar_es_Salaam'
  });

  pruneExpiredActivityLogs().catch((err) => {
    console.error('Unable to prune expired activity logs:', err);
  });
}

module.exports = { startScheduler };
