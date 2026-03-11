# RegIntel — RI-DSS Regulatory Intelligence Platform

AI-powered plain-English summaries of RBI, SEBI and IRDAI circulars.  
Built on the RI-DSS Architecture (Modules 1–4) from published DSR research.

---

## 🚀 Deploy on Replit (5 minutes)

### Step 1 — Import
1. Go to [replit.com](https://replit.com) → **Create Repl**
2. Choose **Import from GitHub** or **Upload files**
3. Upload all files from this folder

### Step 2 — Install dependencies
In the Replit Shell:
```bash
npm install
```

### Step 3 — Set environment variables
In Replit → **Secrets** tab, add:

| Key | Value |
|-----|-------|
| `ANTHROPIC_API_KEY` | Your key from [console.anthropic.com](https://console.anthropic.com) |
| `ADMIN_SECRET` | Any long random string (e.g. `my-secret-2025`) |
| `PORT` | `3000` |
| `NODE_ENV` | `production` |

### Step 4 — Run
```bash
npm start
```

Your site is live at `https://your-repl-name.repl.co` 🎉

---

## 🏗 Architecture (All 4 Modules)

```
Module 1 — Regulatory Monitoring Agent (RMA)
  src/scraper.js
  → Crawls RBI, SEBI, IRDAI portals every 6 hours (node-cron)
  → Stores new circulars in SQLite with deduplication

Module 2 — Classification & Change-Detection (CCDM)
  src/ai.js → classifyCircular(), detectChanges()
  → Claude assigns KYC / Credit / NPA / Digital / Operations / Penal
  → Detects what specifically changed vs. prior circular

Module 3 — Impact Assessment Engine (IAE)
  src/ai.js → assessCircular(), analyzeRawText()
  → Generates plain-English summary, checklist, FAQs, risk rating, deadline alert
  → Public paste-and-analyze tool (free, no login)

Module 4 — Managerial Dashboard & Alert System
  public/index.html (React SPA)
  src/routes/api.js
  → Live feed with source/category filters
  → Email alert subscriptions by role and topic
  → Compliance officer validation endpoint
  → Full audit trail in SQLite
```

---

## 📁 File Structure

```
ridss/
├── server.js              # Express entry point
├── package.json
├── .env.example           # Copy to .env and fill in
├── src/
│   ├── database.js        # SQLite schema + all queries
│   ├── scraper.js         # Module 1: RBI/SEBI/IRDAI crawler
│   ├── ai.js              # Module 2+3: Claude classification + assessment
│   ├── scheduler.js       # Cron jobs (scrape 6h, process 30min)
│   └── routes/
│       └── api.js         # All REST endpoints
└── public/
    └── index.html         # Full React frontend (no build step)
```

---

## 🌐 API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/circulars` | List circulars (filter: source, category, search) |
| GET | `/api/circulars/:id` | Single circular + full AI assessment |
| POST | `/api/analyze` | Paste & analyze any circular text (public) |
| GET | `/api/stats` | Dashboard statistics |
| POST | `/api/subscribe` | Email alert signup |
| POST | `/api/admin/scrape` | Manually trigger scrape (needs ADMIN_SECRET) |
| POST | `/api/admin/process` | Manually trigger AI processing |

### Example: Analyze a circular
```bash
curl -X POST https://your-repl.repl.co/api/analyze \
  -H "Content-Type: application/json" \
  -d '{"text": "RBI/2024-25/117 — The Reserve Bank of India has decided..."}'
```

---

## 💰 Revenue Features Built In

- **Free tool** (paste & analyze) — drives SEO traffic
- **Email subscribers** — foundation for paid digest tier
- **Public SEO pages** — each `/circular/:id` is indexable
- **Admin validation** — compliance officer workflow (B2B feature)
- **Rate limiting** — freemium enforcement (5 analyses/min free)

---

## 🔧 Customisation

**Change scrape frequency** — `src/scheduler.js`:
```js
cron.schedule('0 0,6,12,18 * * *', ...) // every 6h → change as needed
```

**Add email sending** — `src/routes/api.js` subscribe endpoint:
```js
// Uncomment and configure nodemailer with your SMTP credentials
```

**Add Google Analytics** — `public/index.html`:
```html
<!-- Add GA script before </head> -->
```

---

## 📊 Research Basis

This system operationalizes the RI-DSS architecture from:
> *"From Regulatory Overload to Compliance Foresight: Human Behavioural Determinants of AI-Enabled Regulatory Intelligence Adoption in Indian Banking"*
> Design Science Research · Computers in Human Behavior · 2026

Validated across 10 Indian banks: Bank of Baroda, Kerala Bank, HDFC, SBI, Bank of India, South Indian Bank, Federal Bank, IDBI, Canara Bank, Indian Bank.

**Evaluation results:** 77% time reduction · 54% cognitive load reduction · 23 scenario observations
