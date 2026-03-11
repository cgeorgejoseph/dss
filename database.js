// src/database.js — SQLite schema + all query helpers
const Database = require('better-sqlite3');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const DB_PATH = path.join(__dirname, '..', 'ridss.db');
let db;

function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initSchema();
  }
  return db;
}

function initSchema() {
  db.exec(`
    -- ── Circulars ──────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS circulars (
      id            TEXT PRIMARY KEY,
      source        TEXT NOT NULL,          -- RBI | SEBI | IRDAI
      ref_no        TEXT,
      title         TEXT NOT NULL,
      url           TEXT UNIQUE,
      raw_text      TEXT,
      issued_date   TEXT,
      scraped_at    TEXT NOT NULL,
      category      TEXT,                   -- KYC | Credit | NPA | Digital | Operations | Penal | Other
      sub_category  TEXT,
      priority      TEXT DEFAULT 'MEDIUM',  -- HIGH | MEDIUM | LOW
      has_deadline  INTEGER DEFAULT 0,
      deadline_date TEXT,
      status        TEXT DEFAULT 'NEW',     -- NEW | PROCESSED | FAILED
      version_hash  TEXT,
      supersedes_id TEXT,
      processed_at  TEXT
    );

    -- ── AI Assessments (Module 3 output) ───────────────────────────────
    CREATE TABLE IF NOT EXISTS assessments (
      id              TEXT PRIMARY KEY,
      circular_id     TEXT NOT NULL REFERENCES circulars(id),
      summary         TEXT,
      plain_english   TEXT,
      checklist       TEXT,  -- JSON array
      faqs            TEXT,  -- JSON array [{q,a}]
      risk_rating     TEXT,  -- HIGH | MEDIUM | LOW
      risk_rationale  TEXT,
      deadline_alert  TEXT,
      action_items    TEXT,  -- JSON array
      affected_roles  TEXT,  -- JSON array
      key_changes     TEXT,  -- JSON array (change-detection output)
      created_at      TEXT NOT NULL,
      validated_by    TEXT,  -- compliance officer name
      validated_at    TEXT
    );

    -- ── Change Detection Log (Module 2) ────────────────────────────────
    CREATE TABLE IF NOT EXISTS change_log (
      id              TEXT PRIMARY KEY,
      circular_id     TEXT NOT NULL REFERENCES circulars(id),
      prev_circular_id TEXT,
      changes_detected TEXT,  -- JSON array of detected changes
      similarity_score REAL,
      detected_at     TEXT NOT NULL
    );

    -- ── Email subscribers ──────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS subscribers (
      id         TEXT PRIMARY KEY,
      email      TEXT UNIQUE NOT NULL,
      name       TEXT,
      role       TEXT,       -- branch_manager | compliance_officer | credit_officer | operations | other
      categories TEXT,       -- JSON array of subscribed categories
      frequency  TEXT DEFAULT 'daily',  -- daily | weekly | instant
      confirmed  INTEGER DEFAULT 0,
      token      TEXT,
      created_at TEXT NOT NULL,
      last_sent  TEXT
    );

    -- ── Scrape log ─────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS scrape_log (
      id         TEXT PRIMARY KEY,
      source     TEXT NOT NULL,
      status     TEXT NOT NULL,  -- success | failed | partial
      count_new  INTEGER DEFAULT 0,
      error      TEXT,
      ran_at     TEXT NOT NULL
    );

    -- ── Indexes ────────────────────────────────────────────────────────
    CREATE INDEX IF NOT EXISTS idx_circulars_source   ON circulars(source);
    CREATE INDEX IF NOT EXISTS idx_circulars_category ON circulars(category);
    CREATE INDEX IF NOT EXISTS idx_circulars_status   ON circulars(status);
    CREATE INDEX IF NOT EXISTS idx_circulars_date     ON circulars(issued_date DESC);
    CREATE INDEX IF NOT EXISTS idx_assessments_cid    ON assessments(circular_id);
  `);
}

// ── Circular queries ────────────────────────────────────────────────────

function insertCircular(data) {
  const db = getDb();
  const id = uuidv4();
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO circulars
      (id, source, ref_no, title, url, raw_text, issued_date, scraped_at, version_hash, status)
    VALUES
      (@id, @source, @ref_no, @title, @url, @raw_text, @issued_date, @scraped_at, @version_hash, 'NEW')
  `);
  const result = stmt.run({ id, ...data, scraped_at: new Date().toISOString() });
  return result.changes > 0 ? id : null; // null = duplicate
}

function getCircular(id) {
  return getDb().prepare(
    'SELECT c.*, a.summary, a.plain_english, a.checklist, a.faqs, a.risk_rating, a.risk_rationale, a.deadline_alert, a.action_items, a.affected_roles, a.key_changes ' +
    'FROM circulars c LEFT JOIN assessments a ON a.circular_id = c.id WHERE c.id = ?'
  ).get(id);
}

function getCirculars({ source, category, status, limit = 20, offset = 0, search } = {}) {
  let query = `
    SELECT c.id, c.source, c.ref_no, c.title, c.url, c.issued_date, c.scraped_at,
           c.category, c.priority, c.has_deadline, c.deadline_date, c.status,
           a.summary, a.risk_rating, a.affected_roles
    FROM circulars c
    LEFT JOIN assessments a ON a.circular_id = c.id
    WHERE 1=1
  `;
  const params = [];
  if (source)   { query += ' AND c.source = ?';   params.push(source); }
  if (category) { query += ' AND c.category = ?'; params.push(category); }
  if (status)   { query += ' AND c.status = ?';   params.push(status); }
  if (search)   { query += ' AND (c.title LIKE ? OR c.ref_no LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }
  query += ' ORDER BY c.issued_date DESC, c.scraped_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);
  return getDb().prepare(query).all(...params);
}

function getUnprocessed(limit = 10) {
  return getDb().prepare(
    "SELECT * FROM circulars WHERE status = 'NEW' ORDER BY scraped_at ASC LIMIT ?"
  ).all(limit);
}

function markProcessed(id, category, priority, hasDeadline, deadlineDate) {
  getDb().prepare(`
    UPDATE circulars SET status='PROCESSED', category=?, priority=?, has_deadline=?,
    deadline_date=?, processed_at=? WHERE id=?
  `).run(category, priority, hasDeadline ? 1 : 0, deadlineDate, new Date().toISOString(), id);
}

function markFailed(id, err) {
  getDb().prepare("UPDATE circulars SET status='FAILED' WHERE id=?").run(id);
}

function findByUrl(url) {
  return getDb().prepare('SELECT id FROM circulars WHERE url = ?').get(url);
}

function findByCategory(category, limit = 5) {
  return getDb().prepare(
    "SELECT id, title, ref_no, issued_date FROM circulars WHERE category=? AND status='PROCESSED' ORDER BY issued_date DESC LIMIT ?"
  ).all(category, limit);
}

// ── Assessment queries ────────────────────────────────────────────────

function insertAssessment(circularId, data) {
  const db = getDb();
  const id = uuidv4();
  db.prepare(`
    INSERT OR REPLACE INTO assessments
      (id, circular_id, summary, plain_english, checklist, faqs, risk_rating,
       risk_rationale, deadline_alert, action_items, affected_roles, key_changes, created_at)
    VALUES
      (@id, @circular_id, @summary, @plain_english, @checklist, @faqs, @risk_rating,
       @risk_rationale, @deadline_alert, @action_items, @affected_roles, @key_changes, @created_at)
  `).run({
    id,
    circular_id: circularId,
    summary:        data.summary || '',
    plain_english:  data.plain_english || '',
    checklist:      JSON.stringify(data.checklist || []),
    faqs:           JSON.stringify(data.faqs || []),
    risk_rating:    data.risk_rating || 'MEDIUM',
    risk_rationale: data.risk_rationale || '',
    deadline_alert: data.deadline_alert || '',
    action_items:   JSON.stringify(data.action_items || []),
    affected_roles: JSON.stringify(data.affected_roles || []),
    key_changes:    JSON.stringify(data.key_changes || []),
    created_at:     new Date().toISOString(),
  });
  return id;
}

function validateAssessment(circularId, officer) {
  getDb().prepare(
    'UPDATE assessments SET validated_by=?, validated_at=? WHERE circular_id=?'
  ).run(officer, new Date().toISOString(), circularId);
}

// ── Change log queries ────────────────────────────────────────────────

function insertChangeLog(circularId, prevId, changes, similarity) {
  getDb().prepare(`
    INSERT INTO change_log (id, circular_id, prev_circular_id, changes_detected, similarity_score, detected_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(uuidv4(), circularId, prevId, JSON.stringify(changes), similarity, new Date().toISOString());
}

// ── Subscriber queries ────────────────────────────────────────────────

function addSubscriber(email, name, role, categories, frequency) {
  const token = uuidv4();
  try {
    getDb().prepare(`
      INSERT INTO subscribers (id, email, name, role, categories, frequency, token, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(uuidv4(), email, name, role, JSON.stringify(categories), frequency, token, new Date().toISOString());
    return token;
  } catch (e) {
    return null; // duplicate email
  }
}

function confirmSubscriber(token) {
  const result = getDb().prepare('UPDATE subscribers SET confirmed=1 WHERE token=?').run(token);
  return result.changes > 0;
}

function getSubscribers(category) {
  let query = "SELECT * FROM subscribers WHERE confirmed=1";
  const params = [];
  if (category) {
    query += " AND (categories LIKE ? OR categories LIKE '%\"all\"%')";
    params.push(`%"${category}"%`);
  }
  return getDb().prepare(query).all(...params);
}

// ── Scrape log ────────────────────────────────────────────────────────

function logScrape(source, status, countNew, error) {
  getDb().prepare('INSERT INTO scrape_log (id, source, status, count_new, error, ran_at) VALUES (?,?,?,?,?,?)').run(
    uuidv4(), source, status, countNew, error || null, new Date().toISOString()
  );
}

function getStats() {
  const db = getDb();
  return {
    total:     db.prepare("SELECT COUNT(*) as n FROM circulars").get().n,
    processed: db.prepare("SELECT COUNT(*) as n FROM circulars WHERE status='PROCESSED'").get().n,
    today:     db.prepare("SELECT COUNT(*) as n FROM circulars WHERE date(scraped_at)=date('now')").get().n,
    bySource:  db.prepare("SELECT source, COUNT(*) as n FROM circulars GROUP BY source").all(),
    byCategory:db.prepare("SELECT category, COUNT(*) as n FROM circulars WHERE category IS NOT NULL GROUP BY category").all(),
    highRisk:  db.prepare("SELECT COUNT(*) as n FROM assessments WHERE risk_rating='HIGH'").get().n,
    subscribers: db.prepare("SELECT COUNT(*) as n FROM subscribers WHERE confirmed=1").get().n,
  };
}

module.exports = {
  getDb, insertCircular, getCircular, getCirculars, getUnprocessed,
  markProcessed, markFailed, findByUrl, findByCategory,
  insertAssessment, validateAssessment, insertChangeLog,
  addSubscriber, confirmSubscriber, getSubscribers,
  logScrape, getStats,
};
