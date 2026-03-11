// src/scheduler.js — cron jobs for Module 1 (scrape) + Module 2/3 (process)
const cron = require('node-cron');
const { runScraper } = require('./scraper');
const { processNext } = require('./ai');

function startScheduler() {
  console.log('[Scheduler] Starting...');

  // Module 1: Scrape every 6 hours — 6am, 12pm, 6pm, 12am IST
  cron.schedule('0 0,6,12,18 * * *', async () => {
    console.log('[Scheduler] Scrape job triggered');
    try {
      await runScraper();
    } catch (e) {
      console.error('[Scheduler] Scrape error:', e.message);
    }
  }, { timezone: 'Asia/Kolkata' });

  // Module 2/3: Process new circulars every 30 minutes
  cron.schedule('*/30 * * * *', async () => {
    console.log('[Scheduler] AI processing job triggered');
    try {
      await processNext(5);
    } catch (e) {
      console.error('[Scheduler] AI processing error:', e.message);
    }
  });

  // Run once on startup (after 10s delay to let server settle)
  setTimeout(async () => {
    console.log('[Scheduler] Startup: running initial scrape + process');
    try {
      await runScraper();
      await processNext(3);
    } catch (e) {
      console.error('[Scheduler] Startup error:', e.message);
    }
  }, 10000);
}

module.exports = { startScheduler };
