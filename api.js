// src/routes/api.js — All REST API endpoints
const express = require('express');
const router  = express.Router();
const db      = require('../database');
const { analyzeRawText, processNext } = require('../ai');
const { runScraper } = require('../scraper');

// ── GET /api/circulars — list with filters ─────────────────────────
router.get('/circulars', (req, res) => {
  try {
    const { source, category, status, search, limit = 20, offset = 0 } = req.query;
    const circulars = db.getCirculars({
      source, category, status,
      search,
      limit: Math.min(parseInt(limit) || 20, 100),
      offset: parseInt(offset) || 0,
    });
    res.json({ success: true, data: circulars, count: circulars.length });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── GET /api/circulars/:id — single circular with full assessment ───
router.get('/circulars/:id', (req, res) => {
  try {
    const circular = db.getCircular(req.params.id);
    if (!circular) return res.status(404).json({ success: false, error: 'Not found' });

    // Parse JSON fields
    for (const f of ['checklist','faqs','action_items','affected_roles','key_changes']) {
      if (circular[f] && typeof circular[f] === 'string') {
        try { circular[f] = JSON.parse(circular[f]); } catch { circular[f] = []; }
      }
    }

    res.json({ success: true, data: circular });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── POST /api/analyze — paste & analyze any circular text ──────────
router.post('/analyze', async (req, res) => {
  try {
    const { text } = req.body;
    if (!text || text.trim().length < 30) {
      return res.status(400).json({ success: false, error: 'Please provide at least 30 characters of circular text.' });
    }
    if (text.length > 12000) {
      return res.status(400).json({ success: false, error: 'Text too long. Please limit to 12,000 characters.' });
    }

    const result = await analyzeRawText(text.trim());
    res.json({ success: true, data: result });
  } catch (e) {
    console.error('[/api/analyze]', e.message);
    res.status(500).json({ success: false, error: 'AI processing failed. Please try again.' });
  }
});

// ── POST /api/validate/:id — compliance officer validates ──────────
router.post('/validate/:id', (req, res) => {
  try {
    const { officer, secret } = req.body;
    if (secret !== process.env.ADMIN_SECRET) {
      return res.status(403).json({ success: false, error: 'Unauthorized' });
    }
    db.validateAssessment(req.params.id, officer || 'Compliance Officer');
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── GET /api/stats — dashboard stats ──────────────────────────────
router.get('/stats', (req, res) => {
  try {
    res.json({ success: true, data: db.getStats() });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── POST /api/subscribe — email alert signup ───────────────────────
router.post('/subscribe', (req, res) => {
  try {
    const { email, name, role, categories, frequency } = req.body;
    if (!email || !email.includes('@')) {
      return res.status(400).json({ success: false, error: 'Valid email required' });
    }
    const cats = Array.isArray(categories) ? categories : ['all'];
    const token = db.addSubscriber(email, name || '', role || 'other', cats, frequency || 'daily');
    if (!token) {
      return res.status(409).json({ success: false, error: 'Email already subscribed' });
    }
    // In production: send confirmation email here
    res.json({ success: true, message: 'Subscribed successfully! Check your email to confirm.' });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── GET /api/confirm/:token — confirm subscription ─────────────────
router.get('/confirm/:token', (req, res) => {
  const ok = db.confirmSubscriber(req.params.token);
  if (ok) res.redirect('/?confirmed=1');
  else res.status(400).json({ success: false, error: 'Invalid or expired token' });
});

// ── POST /api/admin/scrape — manually trigger scrape ──────────────
router.post('/admin/scrape', async (req, res) => {
  if (req.body.secret !== process.env.ADMIN_SECRET) {
    return res.status(403).json({ success: false, error: 'Unauthorized' });
  }
  res.json({ success: true, message: 'Scrape triggered' });
  runScraper().catch(console.error);
});

// ── POST /api/admin/process — manually trigger AI processing ───────
router.post('/admin/process', async (req, res) => {
  if (req.body.secret !== process.env.ADMIN_SECRET) {
    return res.status(403).json({ success: false, error: 'Unauthorized' });
  }
  const limit = parseInt(req.body.limit) || 10;
  res.json({ success: true, message: `Processing up to ${limit} circulars` });
  processNext(limit).catch(console.error);
});

module.exports = router;
