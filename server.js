// server.js — Main entry point
require('dotenv').config();
const express    = require('express');
const helmet     = require('helmet');
const cors       = require('cors');
const rateLimit  = require('express-rate-limit');
const path       = require('path');

const apiRoutes  = require('./src/routes/api');
const { startScheduler } = require('./src/scheduler');
const { getDb }  = require('./src/database');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Security & middleware ────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc:  ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://unpkg.com"],
      styleSrc:   ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc:    ["'self'", "https://fonts.gstatic.com"],
      connectSrc: ["'self'"],
    },
  },
}));
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '200kb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ── Rate limiting ────────────────────────────────────────────────────
const apiLimiter = rateLimit({ windowMs: 60*1000, max: 60, standardHeaders: true });
const analyzeLimiter = rateLimit({ windowMs: 60*1000, max: 5, message: { success:false, error:'Too many requests. Free tier: 5/minute.' } });

app.use('/api', apiLimiter);
app.use('/api/analyze', analyzeLimiter);

// ── Routes ───────────────────────────────────────────────────────────
app.use('/api', apiRoutes);

// SEO: individual circular pages route to SPA
app.get('/circular/:id', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Start ────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🏦 RIDSS Server running on port ${PORT}`);
  console.log(`📡 Module 1 (RMA): Scraper scheduled every 6h`);
  console.log(`🧠 Modules 2+3 (CCDM+IAE): AI processing every 30min`);
  console.log(`🔔 Module 4 (Dashboard): Live at http://localhost:${PORT}\n`);

  // Init DB
  getDb();

  // Start automated scheduler
  if (process.env.NODE_ENV !== 'test') {
    startScheduler();
  }
});

module.exports = app;
