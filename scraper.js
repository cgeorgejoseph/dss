// src/scraper.js — Module 1: Regulatory Monitoring Agent (RMA)
// Crawls RBI, SEBI, IRDAI portals for new circulars every 6 hours
const axios = require('axios');
const cheerio = require('cheerio');
const crypto = require('crypto');
const db = require('./database');

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (compatible; RIDSSBot/1.0; +https://ridss.in/bot)',
  'Accept': 'text/html,application/xhtml+xml',
  'Accept-Language': 'en-IN,en;q=0.9',
};

function hashText(text) {
  return crypto.createHash('sha256').update(text || '').digest('hex').slice(0, 16);
}

async function fetchPage(url, timeout = 15000) {
  const res = await axios.get(url, { headers: HEADERS, timeout });
  return cheerio.load(res.data);
}

// ── RBI Scraper ────────────────────────────────────────────────────────
async function scrapeRBI() {
  const sources = [
    {
      url: 'https://www.rbi.org.in/Scripts/BS_CircularIndexDisplay.aspx',
      name: 'Circulars',
    },
    {
      url: 'https://www.rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx',
      name: 'Press Releases',
    },
    {
      url: 'https://www.rbi.org.in/Scripts/NotificationUser.aspx',
      name: 'Notifications',
    },
  ];

  const results = [];

  for (const source of sources) {
    try {
      const $ = await fetchPage(source.url);
      const rows = $('table.tablebg tr, table tr').toArray().slice(0, 30);

      for (const row of rows) {
        const cells = $(row).find('td');
        if (cells.length < 2) continue;

        const linkEl = $(cells[1]).find('a').first();
        const title = linkEl.text().trim();
        const href  = linkEl.attr('href');
        const date  = $(cells[0]).text().trim();

        if (!title || !href || title.length < 10) continue;

        const url = href.startsWith('http')
          ? href
          : `https://www.rbi.org.in${href.startsWith('/') ? '' : '/Scripts/'}${href}`;

        const refEl = $(cells).filter((_, el) => /RBI\/\d/.test($(el).text()));
        const refNo = refEl.length ? refEl.text().trim() : null;

        if (!db.findByUrl(url)) {
          results.push({
            source: 'RBI',
            ref_no: refNo,
            title,
            url,
            raw_text: null,
            issued_date: parseIndianDate(date),
            version_hash: hashText(title + url),
          });
        }
      }
    } catch (e) {
      console.error(`[RBI Scraper] ${source.name} error:`, e.message);
    }
  }

  return results;
}

// ── SEBI Scraper ───────────────────────────────────────────────────────
async function scrapeSEBI() {
  const urls = [
    'https://www.sebi.gov.in/sebiweb/home/HomeAction.do?doListing=yes&sid=5&ssid=15&smid=0',
    'https://www.sebi.gov.in/sebiweb/home/HomeAction.do?doListing=yes&sid=5&ssid=46&smid=0',
  ];

  const results = [];

  for (const url of urls) {
    try {
      const $ = await fetchPage(url);
      $('table.tab tbody tr, .listing-table tr').each((_, row) => {
        const cells = $(row).find('td');
        if (cells.length < 2) return;

        const linkEl = $(cells).find('a').first();
        const title  = linkEl.text().trim();
        const href   = linkEl.attr('href');
        const date   = $(cells[0]).text().trim();

        if (!title || !href || title.length < 8) return;

        const fullUrl = href.startsWith('http')
          ? href
          : `https://www.sebi.gov.in${href}`;

        if (!db.findByUrl(fullUrl)) {
          results.push({
            source: 'SEBI',
            ref_no: null,
            title,
            url: fullUrl,
            raw_text: null,
            issued_date: parseIndianDate(date),
            version_hash: hashText(title + fullUrl),
          });
        }
      });
    } catch (e) {
      console.error('[SEBI Scraper] error:', e.message);
    }
  }

  return results;
}

// ── IRDAI Scraper ──────────────────────────────────────────────────────
async function scrapeIRDAI() {
  const urls = [
    'https://irdai.gov.in/web/guest/circulars',
    'https://irdai.gov.in/web/guest/notifications',
  ];

  const results = [];

  for (const url of urls) {
    try {
      const $ = await fetchPage(url);
      $('table tr, .views-row').each((_, row) => {
        const linkEl = $(row).find('a').first();
        const title  = linkEl.text().trim();
        const href   = linkEl.attr('href');
        const date   = $(row).find('.date-display-single, td').first().text().trim();

        if (!title || !href || title.length < 8) return;

        const fullUrl = href.startsWith('http')
          ? href
          : `https://irdai.gov.in${href}`;

        if (!db.findByUrl(fullUrl)) {
          results.push({
            source: 'IRDAI',
            ref_no: null,
            title,
            url: fullUrl,
            raw_text: null,
            issued_date: parseIndianDate(date),
            version_hash: hashText(title + fullUrl),
          });
        }
      });
    } catch (e) {
      console.error('[IRDAI Scraper] error:', e.message);
    }
  }

  return results;
}

// ── Full text fetcher ──────────────────────────────────────────────────
async function fetchFullText(url) {
  try {
    const $ = await fetchPage(url, 20000);
    // Remove scripts, styles, nav
    $('script, style, nav, header, footer, .menu, #header, #footer').remove();
    // Get main content
    const content = $('main, .content, #content, .container, body')
      .first().text()
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 8000); // limit for AI processing
    return content || null;
  } catch (e) {
    return null;
  }
}

// ── Date parser ────────────────────────────────────────────────────────
function parseIndianDate(str) {
  if (!str) return new Date().toISOString().split('T')[0];
  str = str.trim();

  // DD-MM-YYYY or DD/MM/YYYY
  const dmy = str.match(/(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2,'0')}-${dmy[1].padStart(2,'0')}`;

  // Month DD, YYYY or DD Month YYYY
  const months = { jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12 };
  const named = str.match(/(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/);
  if (named) {
    const m = months[named[2].toLowerCase().slice(0,3)];
    if (m) return `${named[3]}-${String(m).padStart(2,'0')}-${named[1].padStart(2,'0')}`;
  }

  try { return new Date(str).toISOString().split('T')[0]; } catch { return new Date().toISOString().split('T')[0]; }
}

// ── Main run ───────────────────────────────────────────────────────────
async function runScraper() {
  console.log('[RMA] Starting scrape cycle...', new Date().toISOString());
  let totalNew = 0;

  const scrapers = [
    { name: 'RBI', fn: scrapeRBI },
    { name: 'SEBI', fn: scrapeSEBI },
    { name: 'IRDAI', fn: scrapeIRDAI },
  ];

  for (const { name, fn } of scrapers) {
    try {
      const items = await fn();
      let countNew = 0;

      for (const item of items) {
        // Optionally fetch full text (rate-limited — only first 3 per run)
        if (countNew < 3 && !item.raw_text) {
          item.raw_text = await fetchFullText(item.url);
          await sleep(2000); // polite delay
        }
        const id = db.insertCircular(item);
        if (id) countNew++;
      }

      db.logScrape(name, 'success', countNew, null);
      console.log(`[RMA] ${name}: ${countNew} new circulars`);
      totalNew += countNew;
    } catch (err) {
      db.logScrape(name, 'failed', 0, err.message);
      console.error(`[RMA] ${name} failed:`, err.message);
    }

    await sleep(3000); // polite delay between sources
  }

  console.log(`[RMA] Cycle complete. ${totalNew} new items queued for processing.`);
  return totalNew;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

module.exports = { runScraper, fetchFullText, parseIndianDate };
