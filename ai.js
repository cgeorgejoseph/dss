// src/ai.js — Module 2 (CCDM) + Module 3 (IAE) via Anthropic Claude
const Anthropic = require('@anthropic-ai/sdk');
const db = require('./database');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL  = 'claude-sonnet-4-20250514';

// ── Module 2: Classification & Change-Detection ─────────────────────

async function classifyCircular(title, text) {
  const prompt = `You are a compliance classification engine for Indian banking regulators (RBI, SEBI, IRDAI).

Classify this regulatory circular into EXACTLY ONE primary category and assess its properties.

CIRCULAR TITLE: ${title}
CIRCULAR TEXT (first 3000 chars): ${(text || '').slice(0, 3000)}

Respond with ONLY valid JSON — no markdown, no explanation:
{
  "category": "KYC|Credit|NPA|Digital|Operations|Penal|Treasury|HR|Other",
  "sub_category": "brief sub-topic",
  "priority": "HIGH|MEDIUM|LOW",
  "has_deadline": true|false,
  "deadline_date": "YYYY-MM-DD or null",
  "affected_roles": ["branch_manager","credit_officer","operations","kyc_officer","compliance_officer"],
  "confidence": 0.0-1.0
}

Priority rules: HIGH = immediate action required, new penalty/fine, deadline within 30 days.
MEDIUM = policy change requiring process update within 90 days.
LOW = informational, clarification, or long-term guideline.`;

  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 400,
    messages: [{ role: 'user', content: prompt }],
  });

  const raw = msg.content[0].text.trim().replace(/```json|```/g, '').trim();
  return JSON.parse(raw);
}

async function detectChanges(newTitle, newText, prevTitle, prevText) {
  if (!prevText || !newText) return { changes: [], similarity: 0 };

  const prompt = `You are a regulatory change-detection engine. Compare two versions of an RBI/SEBI/IRDAI circular and identify SPECIFIC changes.

PREVIOUS CIRCULAR: "${prevTitle}"
${prevText.slice(0, 2000)}

NEW CIRCULAR: "${newTitle}"  
${newText.slice(0, 2000)}

Respond with ONLY valid JSON:
{
  "similarity_score": 0.0-1.0,
  "is_supersession": true|false,
  "changes": [
    {
      "type": "LIMIT_CHANGE|DATE_CHANGE|PROCESS_CHANGE|NEW_REQUIREMENT|REMOVED_REQUIREMENT|CLARIFICATION",
      "description": "plain English description of what changed",
      "old_value": "previous value/text or null",
      "new_value": "new value/text",
      "impact": "HIGH|MEDIUM|LOW"
    }
  ],
  "summary": "one sentence: what changed overall"
}`;

  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 800,
    messages: [{ role: 'user', content: prompt }],
  });

  const raw = msg.content[0].text.trim().replace(/```json|```/g, '').trim();
  const result = JSON.parse(raw);
  return { changes: result.changes, similarity: result.similarity_score, isSupersession: result.is_supersession, summary: result.summary };
}

// ── Module 3: Impact Assessment Engine ─────────────────────────────

async function assessCircular(title, text, category, source) {
  const prompt = `You are an expert regulatory compliance advisor for Indian banking. Convert this ${source} circular into officer-ready intelligence.

CIRCULAR: "${title}"
CATEGORY: ${category}
TEXT: ${(text || title).slice(0, 4000)}

Respond with ONLY valid JSON — no markdown:
{
  "summary": "2-3 sentence executive summary in plain English",
  "plain_english": "Full plain-English explanation (150-200 words). What this means for day-to-day banking operations. No legal jargon.",
  "checklist": [
    "Action item 1 — specific, actionable, assignable",
    "Action item 2",
    "Action item 3"
  ],
  "faqs": [
    { "q": "Common question an officer would ask", "a": "Clear direct answer" },
    { "q": "Another common question", "a": "Clear direct answer" },
    { "q": "Third question", "a": "Clear direct answer" }
  ],
  "risk_rating": "HIGH|MEDIUM|LOW",
  "risk_rationale": "1 sentence explaining the risk rating",
  "deadline_alert": "Specific deadline or compliance date if any, else null",
  "action_items": [
    { "task": "specific task", "role": "who should do it", "urgency": "IMMEDIATE|THIS_WEEK|THIS_MONTH" }
  ],
  "key_numbers": ["any important figures, limits, percentages, amounts mentioned"],
  "affected_roles": ["branch_manager","credit_officer","operations","kyc_officer","compliance_officer"]
}

Be specific to Indian banking context. Use ₹ for currency. Reference relevant sections if visible.`;

  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 1500,
    messages: [{ role: 'user', content: prompt }],
  });

  const raw = msg.content[0].text.trim().replace(/```json|```/g, '').trim();
  return JSON.parse(raw);
}

// ── Public paste-and-analyze tool ────────────────────────────────────

async function analyzeRawText(text) {
  // First classify
  const classification = await classifyCircular('User-submitted circular', text);
  // Then assess
  const assessment = await assessCircular('User-submitted circular', text, classification.category, 'RBI/SEBI/IRDAI');
  return { classification, assessment };
}

// ── Processing pipeline (runs on unprocessed circulars) ──────────────

async function processNext(limit = 5) {
  const pending = db.getUnprocessed(limit);
  console.log(`[AI] Processing ${pending.length} unprocessed circulars...`);

  for (const circular of pending) {
    try {
      const text = circular.raw_text || circular.title;

      // Module 2: Classify
      const cls = await classifyCircular(circular.title, text);

      // Module 2: Change detection — find previous circular in same category
      const prev = db.findByCategory(cls.category, 1)[0];
      if (prev && prev.id !== circular.id) {
        // In production you'd fetch prev raw_text from DB
        const changes = await detectChanges(circular.title, text, prev.title, text);
        if (changes.changes.length > 0) {
          db.insertChangeLog(circular.id, prev.id, changes.changes, changes.similarity);
        }
      }

      // Module 3: Assess
      const assessment = await assessCircular(circular.title, text, cls.category, circular.source);

      // Save assessment
      db.insertAssessment(circular.id, {
        ...assessment,
        key_changes: [], // populated by change log
      });

      // Update circular record
      db.markProcessed(
        circular.id,
        cls.category,
        cls.priority,
        cls.has_deadline,
        cls.deadline_date
      );

      console.log(`[AI] Processed: ${circular.title.slice(0, 60)} → ${cls.category} / ${cls.priority}`);

      // Rate limit: 1 req/sec
      await new Promise(r => setTimeout(r, 1200));

    } catch (err) {
      console.error(`[AI] Failed to process ${circular.id}:`, err.message);
      db.markFailed(circular.id, err.message);
    }
  }
}

module.exports = { classifyCircular, detectChanges, assessCircular, analyzeRawText, processNext };
