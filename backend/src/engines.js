/**
 * Automation rule engine (Trigger → Condition → Actions, with execution log)
 * and optional Ollama AI with a deterministic rules-engine fallback.
 */
const { db } = require("./db");
const { config } = require("./core");

// ---------------- automation ----------------
function leadPayload(lead) {
  return { score: lead.score, city: lead.city, category: lead.category, industry: lead.industry,
           priority: lead.priority, status: lead.status, estimated_value: Number(lead.estimated_value || 0) };
}
function condOk(rule, payload) {
  if (!rule.cond_field) return true;
  const actual = payload[rule.cond_field];
  if (actual === undefined || actual === null) return false;
  const want = rule.cond_value;
  switch (rule.cond_op) {
    case "eq": return String(actual) === want;
    case "neq": return String(actual) !== want;
    case "contains": return String(actual).toLowerCase().includes(String(want).toLowerCase());
    case "gte": return Number(actual) >= Number(want);
    case "lte": return Number(actual) <= Number(want);
    default: return false;
  }
}

async function runTriggers(trigger, { lead = null, extra = {} } = {}) {
  const payload = { ...extra, ...(lead ? leadPayload(lead) : {}) };
  const rules = await db.all("SELECT * FROM automation_rules WHERE trigger = $1 AND enabled = TRUE", [trigger]);
  const ran = [];
  for (const rule of rules) {
    if (!condOk(rule, payload)) continue;
    for (const action of rule.actions || []) {
      if (action.type === "set_priority" && lead) await db.query("UPDATE leads SET priority = $1 WHERE id = $2", [action.value, lead.id]);
      else if (action.type === "set_status" && lead) await db.query("UPDATE leads SET status = $1 WHERE id = $2", [action.value, lead.id]);
      else if (action.type === "assign_user" && lead && action.value !== "managers")
        await db.query("UPDATE leads SET assigned_user_id = $1 WHERE id = $2", [Number(action.value), lead.id]);
      else if (action.type === "assign_team" && lead) {
        const member = await db.one("SELECT id FROM users WHERE team_id = $1 AND is_sales AND active AND deleted_at IS NULL ORDER BY id", [Number(action.value)]);
        await db.query("UPDATE leads SET assigned_team_id = $1, assigned_user_id = COALESCE($2, assigned_user_id) WHERE id = $3",
          [Number(action.value), member?.id ?? null, lead.id]);
      } else if (action.type === "followup" && lead && lead.assigned_user_id) {
        const hours = Number(action.hours || action.value || 24);
        const when = new Date(Date.now() + hours * 3600_000);
        const date = when.toISOString().slice(0, 10);
        await db.query(
          `INSERT INTO followups (entity_type, lead_id, employee_id, type, date, time, reminder, status, notes)
           VALUES ('lead', $1, $2, $3, $4, $5, TRUE, 'Scheduled', $6)`,
          [lead.id, lead.assigned_user_id, action.fuType || "Call", date, when.toTimeString().slice(0, 5), `Automation: ${rule.name}`]);
        await db.query("UPDATE leads SET next_followup_at = $1 WHERE id = $2", [date, lead.id]);
      } else if (action.type === "notify") {
        const userId = action.value === "managers" ? null : Number(action.value);
        await db.query("INSERT INTO notifications (user_id, title, body, link, kind) VALUES ($1,$2,$3,$4,$5)",
          [userId, extra.title || `Automation: ${rule.name}`, extra.body || "", extra.link || "/leads", extra.kind || "system"]);
      }
    }
    await db.query("INSERT INTO automation_executions (rule_id, rule_name, summary) VALUES ($1,$2,$3)",
      [rule.id, rule.name, `${rule.name} fired on ${trigger}`]);
    ran.push(rule.name);
  }
  return ran;
}

async function sweepOverdueInvoices() {
  const today = new Date().toISOString().slice(0, 10);
  const rows = await db.all("SELECT id, invoice_number, due_date FROM invoices WHERE status IN ('Sent','Partially Paid') AND due_date < $1", [today]);
  for (const inv of rows) {
    await db.query("UPDATE invoices SET status = 'Overdue' WHERE id = $1", [inv.id]);
    await runTriggers("invoice.overdue", { extra: { title: `Invoice ${inv.invoice_number} is overdue`,
      body: `Balance due beyond ${inv.due_date}`, link: "/invoices", kind: "invoice" } });
  }
  return rows.length;
}

// ---------------- AI (Ollama, optional) ----------------
const AI_UNAVAILABLE = "AI temporarily unavailable.";

async function getSetting(key, fallback) {
  const row = await db.one("SELECT value FROM crm_settings WHERE key = $1", [key]);
  return { ...fallback, ...(row?.value || {}) };
}
const aiSettings = () => getSetting("ai", { url: config.ollamaUrl, model: config.ollamaModel, temperature: 0.4, timeout_sec: 20 });
const scoringSettings = () => getSetting("scoring", { phone: 10, email: 10, website: 10, location: 10, industry: 15,
  rating: 5, engagement: 20, target_locations: ["Pune", "Mumbai", "Bengaluru", "Hyderabad"],
  target_industries: ["Software", "Digital Marketing", "E-commerce", "Manufacturing", "Real Estate", "Cyber Security"] });

async function ollamaPing(cfg) {
  try {
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 4000);
    const r = await fetch(`${cfg.url}/api/tags`, { signal: ctrl.signal });
    clearTimeout(t);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    return { ok: true, models: (j.models || []).map((m) => m.name) };
  } catch (e) { return { ok: false, error: String(e.message || e).slice(0, 200), models: [] }; }
}

async function ollamaGenerate(cfg, prompt, maxTokens = 400) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), (cfg.timeout_sec || 20) * 1000);
    const r = await fetch(`${cfg.url}/api/generate`, {
      method: "POST", signal: ctrl.signal, headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: cfg.model, prompt, stream: false,
        options: { temperature: cfg.temperature, num_predict: maxTokens } }),
    });
    clearTimeout(t);
    if (!r.ok) return null;
    const j = await r.json();
    return (j.response || "").trim() || null;
  } catch { return null; }
}

function rulesScore(lead, sc) {
  const parts = []; let score = 15;
  if (lead.phone) { score += sc.phone; parts.push("phone ✓"); }
  if (lead.email) { score += sc.email; parts.push("email ✓"); }
  if (lead.website) { score += sc.website; parts.push("website ✓"); }
  if (lead.city && sc.target_locations.some((t) => lead.city.toLowerCase().includes(t.toLowerCase())))
    { score += sc.location; parts.push(`target location (${lead.city})`); }
  if (lead.industry && sc.target_industries.some((t) => lead.industry.toLowerCase().includes(t.toLowerCase())))
    { score += sc.industry; parts.push(`target industry (${lead.industry})`); }
  if (Number(lead.estimated_value || 0) >= 150000) { score += 10; parts.push("high estimated value"); }
  score = Math.max(5, Math.min(100, score));
  return {
    score,
    temperature: score >= 75 ? "Hot" : score >= 45 ? "Warm" : "Cold",
    intent: score >= 75 ? "High" : score >= 45 ? "Medium" : "Low",
    action: score >= 85 ? "Call" : score >= 75 ? "Demo" : score >= 55 ? "WhatsApp" : score >= 40 ? "Email" : "Follow-up",
    reason: `Rule-scored: ${parts.length ? parts.join(", ") : "limited public contact data available"}.`,
    model: "rules-engine",
  };
}

async function aiQualifyLead(lead) {
  const sc = await scoringSettings();
  const fallback = rulesScore(lead, sc);
  const cfg = await aiSettings();
  const prompt = `You qualify B2B sales leads for an Indian IT services company. Reply ONLY with JSON: ` +
    `{"score": 0-100, "temperature": "Cold|Warm|Hot", "intent": "Low|Medium|High", ` +
    `"action": "Call|WhatsApp|Email|Demo|Follow-up|No Action", "reason": "one sentence"}.\n` +
    `Lead: business=${lead.business_name}; industry=${lead.industry}; category=${lead.category}; city=${lead.city}; ` +
    `website=${lead.website}; phone=${lead.phone ? "yes" : "no"}; email=${lead.email ? "yes" : "no"}; ` +
    `estimated_value=${lead.estimated_value}; source=${lead.source}.`;
  const t0 = Date.now();
  const raw = await ollamaGenerate(cfg, prompt, 220);
  const ms = Date.now() - t0;
  if (raw) {
    try {
      const m = raw.match(/\{[\s\S]*\}/);
      const data = m ? JSON.parse(m[0]) : {};
      const result = {
        score: Math.max(0, Math.min(100, Number(data.score) || fallback.score)),
        temperature: data.temperature || fallback.temperature,
        intent: data.intent || fallback.intent,
        action: data.action || fallback.action,
        reason: String(data.reason || fallback.reason).slice(0, 400),
        model: cfg.model,
      };
      await db.query("INSERT INTO ai_logs (kind, model, prompt, output, ms) VALUES ('qualify',$1,$2,$3,$4)",
        [result.model, prompt, raw, ms]);
      return result;
    } catch { /* fall through to rules engine */ }
  }
  await db.query("INSERT INTO ai_logs (kind, model, prompt, output, ms) VALUES ('qualify','rules-engine',$1,$2,$3)",
    [prompt, fallback.reason, ms]);
  return fallback;
}

async function aiAssist(kind, prompt, fallbackText) {
  const cfg = await aiSettings();
  const t0 = Date.now();
  const raw = await ollamaGenerate(cfg, prompt, 500);
  const ms = Date.now() - t0;
  const used = raw !== null;
  const output = raw || fallbackText;
  await db.query("INSERT INTO ai_logs (kind, model, prompt, output, ms) VALUES ($1,$2,$3,$4,$5)",
    [kind, used ? cfg.model : "rules-engine", prompt, String(output).slice(0, 2000), ms]);
  return { text: output, used_ai: used, note: used ? null : AI_UNAVAILABLE };
}

module.exports = { runTriggers, sweepOverdueInvoices, aiSettings, scoringSettings, ollamaPing,
                   aiQualifyLead, aiAssist, AI_UNAVAILABLE };
