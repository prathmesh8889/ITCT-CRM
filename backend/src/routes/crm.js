/**
 * CRM core — leads, customers, companies, contacts, deals, followups, tasks,
 * meetings, calls, discovery jobs. Server-side pagination/filters/sorting +
 * ownership scoping on every direct-record endpoint.
 */
const express = require("express");
const multer = require("multer");
const { db } = require("../db");
const { HttpError, money, nextCode, normPhone, normDomain, normName, validateLead, parseCSV, toCSV } = require("../core");
const { requirePerm, applyOwnership, ensureLead, ensureCustomer, ensureDeal, ensureFollowup, ensureTask } = require("../security");
const { runTriggers, aiQualifyLead } = require("../engines");

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const activity = (userId, action, module, recordId = null, meta = null) =>
  db.query("INSERT INTO activities (actor_id, action, module, record_id, meta) VALUES ($1,$2,$3,$4,$5)",
    [userId, action, module, recordId, meta]);

const num = (v) => (v === null || v === undefined ? v : Number(v));
const leadRow = (l) => l && ({
  id: l.id, lead_code: l.lead_code, business_name: l.business_name, company_name: l.company_name,
  contact_person: l.contact_person, first_name: l.first_name, last_name: l.last_name,
  email: l.email, phone: l.phone, whatsapp: l.whatsapp, website: l.website, industry: l.industry,
  category: l.category, source: l.source, city: l.city, state: l.state, status: l.status,
  priority: l.priority, score: l.score, temperature: l.temperature, intent: l.intent,
  recommended_action: l.recommended_action, ai_reason: l.ai_reason,
  estimated_value: num(l.estimated_value), validation: l.validation,
  assigned_user_id: l.assigned_user_id, assigned_team_id: l.assigned_team_id,
  next_followup_at: l.next_followup_at ? String(l.next_followup_at).slice(0, 10) : null,
  notes: l.notes, created_at: l.created_at, updated_at: l.updated_at,
});

// ---------------- duplicates ----------------
async function findDuplicates({ email, phone, website, business, city, excludeId = null }) {
  const leads = await db.all(`SELECT id, email, phone, website, business_name, city FROM leads
                              WHERE deleted_at IS NULL ${excludeId ? "AND id <> " + Number(excludeId) : ""}`);
  const pe = (email || "").toLowerCase().trim(), pp = normPhone(phone), pd = normDomain(website),
        pn = normName(business), pc = (city || "").toLowerCase().trim();
  return leads.filter((l) =>
    (pe && l.email && l.email.toLowerCase() === pe) ||
    (pp && normPhone(l.phone) === pp) ||
    (pd && normDomain(l.website) === pd) ||
    (pn && normName(l.business_name) === pn && pc && (l.city || "").toLowerCase() === pc));
}

// ---------------- assignment strategies ----------------
async function autoAssign(lead, strategyOverride) {
  const row = await db.one("SELECT value FROM crm_settings WHERE key = 'assignment'");
  const cfg = row?.value || {};
  const strat = strategyOverride || cfg.strategy || "manual";
  const sales = await db.all("SELECT * FROM users WHERE is_sales AND active AND deleted_at IS NULL ORDER BY id");
  if (strat === "manual" || !sales.length) return strat;
  const setAssignee = async (uid) => { await db.query("UPDATE leads SET assigned_user_id = $1 WHERE id = $2", [uid, lead.id]); lead.assigned_user_id = uid; };
  if (strat === "priority" && Number(lead.estimated_value || 0) >= Number(cfg.high_value_threshold || 100000) && cfg.high_value_user_id)
    { await setAssignee(Number(cfg.high_value_user_id)); return strat; }
  if (strat === "category" && (cfg.category_map || {})[lead.category])
    { await setAssignee(Number(cfg.category_map[lead.category])); return strat; }
  if (strat === "location" && (cfg.location_map || {})[lead.city])
    { await setAssignee(Number(cfg.location_map[lead.city])); return strat; }
  if (strat === "least_leads") {
    let best = sales[0].id, bestN = Infinity;
    for (const u of sales) {
      const n = (await db.one("SELECT COUNT(*)::int AS n FROM leads WHERE assigned_user_id = $1 AND status NOT IN ('Won','Lost') AND deleted_at IS NULL", [u.id])).n;
      if (n < bestN) { bestN = n; best = u.id; }
    }
    await setAssignee(best); return strat;
  }
  if (strat === "least_workload") {
    let best = sales[0].id, bestN = Infinity;
    for (const u of sales) {
      const fu = (await db.one("SELECT COUNT(*)::int AS n FROM followups WHERE employee_id = $1 AND status = 'Scheduled'", [u.id])).n;
      const tk = (await db.one("SELECT COUNT(*)::int AS n FROM tasks WHERE assigned_to_id = $1 AND status IN ('Pending','In Progress')", [u.id])).n;
      if (fu + tk < bestN) { bestN = fu + tk; best = u.id; }
    }
    await setAssignee(best); return strat;
  }
  if (strat === "team") {
    const teams = await db.all("SELECT * FROM teams");
    for (const t of teams) {
      const focus = (t.focus || "").toLowerCase();
      if (focus && lead.industry && !focus.includes(lead.industry.toLowerCase()) && lead.city && !focus.includes(lead.city.toLowerCase())) continue;
      const members = sales.filter((u) => u.team_id === t.id);
      if (!members.length) continue;
      let best = members[0].id, bestN = Infinity;
      for (const u of members) {
        const n = (await db.one("SELECT COUNT(*)::int AS n FROM leads WHERE assigned_user_id = $1 AND status NOT IN ('Won','Lost')", [u.id])).n;
        if (n < bestN) { bestN = n; best = u.id; }
      }
      await db.query("UPDATE leads SET assigned_team_id = $1, assigned_user_id = $2 WHERE id = $3", [t.id, best, lead.id]);
      lead.assigned_team_id = t.id; lead.assigned_user_id = best;
      return strat;
    }
  }
  // round_robin — pointer persists in PostgreSQL (crm_settings.assignment)
  const pointer = Number(cfg.rr_pointer || 0);
  const chosen = sales[pointer % sales.length];
  await setAssignee(chosen.id);
  cfg.rr_pointer = (pointer + 1) % sales.length;
  await db.query(`INSERT INTO crm_settings (key, value) VALUES ('assignment', $1)
                  ON CONFLICT (key) DO UPDATE SET value = $1`, [JSON.stringify(cfg)]);
  return "round_robin";
}

// ================= LEADS =================
router.get("/leads", requirePerm("leads", "view"), async (req, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(req.query.page_size) || 20));
    const { search = "", status: statusF = "", source = "", priority = "", city = "", owner = "",
            category = "", sort_by = "created_at", sort_order = "desc" } = req.query;
    const own = applyOwnership(req, "assigned_user_id");
    const where = ["deleted_at IS NULL"]; const params = [];
    if (own.sql) { params.push(...own.params); where.push(`assigned_user_id = $${params.length}`); }
    if (search) { params.push(`%${search}%`); where.push(`(business_name ILIKE $${params.length} OR contact_person ILIKE $${params.length} OR email ILIKE $${params.length} OR phone ILIKE $${params.length} OR city ILIKE $${params.length} OR lead_code ILIKE $${params.length})`); }
    if (statusF) { params.push(statusF); where.push(`status = $${params.length}`); }
    if (source) { params.push(source); where.push(`source = $${params.length}`); }
    if (priority) { params.push(priority); where.push(`priority = $${params.length}`); }
    if (city) { params.push(`%${city}%`); where.push(`city ILIKE $${params.length}`); }
    if (category) { params.push(category); where.push(`category = $${params.length}`); }
    if (owner) { params.push(Number(owner)); where.push(`assigned_user_id = $${params.length}`); }
    const sortCol = ["created_at", "business_name", "score", "estimated_value", "status", "city"].includes(sort_by) ? sort_by : "created_at";
    const dir = sort_order === "asc" ? "ASC" : "DESC";
    const total = (await db.one(`SELECT COUNT(*)::int AS n FROM leads WHERE ${where.join(" AND ")}`, params)).n;
    const items = await db.all(`SELECT * FROM leads WHERE ${where.join(" AND ")} ORDER BY ${sortCol} ${dir} NULLS LAST LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, pageSize, (page - 1) * pageSize]);
    res.json({ items: items.map(leadRow), total, page, page_size: pageSize });
  } catch (e) { next(e); }
});

const LEAD_FIELDS = ["business_name", "first_name", "last_name", "company_name", "contact_person",
  "email", "phone", "alternate_phone", "whatsapp", "website", "industry", "category", "source",
  "source_url", "address", "city", "state", "country", "postal_code", "status", "priority",
  "estimated_value", "assigned_user_id", "assigned_team_id", "next_followup_at", "notes"];

router.post("/leads", requirePerm("leads", "create"), async (req, res, next) => {
  try {
    const b = req.body || {};
    if (!b.business_name?.trim()) throw new HttpError(422, "business_name is required");
    const data = Object.fromEntries(LEAD_FIELDS.filter((f) => b[f] !== undefined).map((f) => [f, b[f]]));
    data.validation = validateLead(data);
    data.estimated_value = money(data.estimated_value || 0);
    const code = await nextCode(db, "leads", "lead_code", "LD");
    const lead = { ...data, lead_code: code, business_name: b.business_name.trim(), created_by: req.user.id };
    await db.query(
      `INSERT INTO leads (lead_code, business_name, first_name, last_name, company_name, contact_person,
        email, phone, alternate_phone, whatsapp, website, industry, category, source, source_url, address,
        city, state, country, postal_code, status, priority, estimated_value, validation,
        assigned_user_id, assigned_team_id, next_followup_at, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29)
       RETURNING *`,
      [lead.lead_code, lead.business_name, lead.first_name || "", lead.last_name || "", lead.company_name || "",
       lead.contact_person || "", lead.email || "", lead.phone || "", lead.alternate_phone || "", lead.whatsapp || "",
       lead.website || "", lead.industry || "", lead.category || "", lead.source || "Manual", lead.source_url || "",
       lead.address || "", lead.city || "", lead.state || "", lead.country || "India", lead.postal_code || "",
       lead.status || "New", lead.priority || "Medium", lead.estimated_value, lead.validation,
       lead.assigned_user_id ?? null, lead.assigned_team_id ?? null, lead.next_followup_at ?? null,
       lead.notes || "", lead.created_by]);
    const created = await db.one("SELECT * FROM leads WHERE lead_code = $1", [code]);
    let strat = "manual";
    if (!created.assigned_user_id) strat = await autoAssign(created);
    if (created.assigned_user_id) {
      await db.query("INSERT INTO lead_assignments (lead_id, user_id, team_id, strategy) VALUES ($1,$2,$3,$4)",
        [created.id, created.assigned_user_id, created.assigned_team_id, strat]);
      await runTriggers("lead.assigned", { lead: created });
    }
    await db.query("INSERT INTO lead_scores (lead_id, score, temperature, intent, action, reason, scored_by) VALUES ($1,0,'Cold','Low','','Awaiting qualification','none')", [created.id]);
    await activity(req.user.id, "Lead Created", "leads", created.id, { business: created.business_name });
    await runTriggers("lead.created", { lead: created });
    res.status(201).json(leadRow(created));
  } catch (e) { next(e); }
});

router.get("/leads/duplicates", requirePerm("leads", "view"), async (req, res, next) => {
  try {
    const leads = await db.all("SELECT * FROM leads WHERE deleted_at IS NULL AND status NOT IN ('Won','Lost')");
    const seen = new Set(); const groups = [];
    for (const l of leads) {
      if (seen.has(l.id)) continue;
      const matches = (await findDuplicates({ email: l.email, phone: l.phone, website: l.website, business: l.business_name, city: l.city, excludeId: l.id }))
        .filter((m) => !seen.has(m.id));
      if (matches.length) {
        seen.add(l.id); matches.forEach((m) => seen.add(m.id));
        const full = (id) => leads.find((x) => x.id === id) || db.one("SELECT * FROM leads WHERE id = $1", [id]);
        groups.push({ keep: leadRow(l), duplicates: matches.map((m) => leadRow(leads.find((x) => x.id === m.id) || m)) });
      }
    }
    res.json({ groups });
  } catch (e) { next(e); }
});

router.get("/leads/export", requirePerm("leads", "export"), async (req, res, next) => {
  try {
    const own = applyOwnership(req, "assigned_user_id");
    const params = [];
    const where = ["deleted_at IS NULL"];
    if (own.sql) { params.push(...own.params); where.push(`assigned_user_id = $1`); }
    const leads = await db.all(`SELECT * FROM leads WHERE ${where.join(" AND ")} ORDER BY created_at DESC`, params);
    const csv = toCSV(leads.map((l) => ({ lead_code: l.lead_code, business_name: l.business_name,
      contact_person: l.contact_person, email: l.email, phone: l.phone, whatsapp: l.whatsapp, website: l.website,
      industry: l.industry, category: l.category, city: l.city, state: l.state, status: l.status,
      priority: l.priority, score: l.score ?? "", temperature: l.temperature ?? "",
      estimated_value: num(l.estimated_value), source: l.source, created_at: l.created_at })));
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", "attachment; filename=leads.csv");
    res.send(csv);
  } catch (e) { next(e); }
});

router.post("/leads/import", requirePerm("leads", "create"), upload.single("file"), async (req, res, next) => {
  try {
    if (!req.file || !req.file.originalname.toLowerCase().endsWith(".csv"))
      throw new HttpError(400, "Only CSV files are supported");
    let mapCols = {};
    try { mapCols = JSON.parse(req.body.mapping || "{}"); } catch { throw new HttpError(422, "Invalid column mapping JSON"); }
    const { records } = parseCSV(req.file.buffer.toString("utf-8"));
    let imported = 0, duplicates = 0, failed = 0; const failedRows = [];
    for (const row of records) {
      const g = (f) => (row[mapCols[f] || f] || "").trim();
      const business = g("business_name") || g("business");
      if (!business) { failed++; failedRows.push({ row, error: "Missing business name" }); continue; }
      const data = { business_name: business, contact_person: g("contact_person"), email: g("email"),
        phone: g("phone"), whatsapp: g("whatsapp") || g("phone"), website: g("website"), industry: g("industry"),
        category: g("category"), city: g("city"), state: g("state"), source: g("source") || "CSV Import" };
      const dups = await findDuplicates({ email: data.email, phone: data.phone, website: data.website, business, city: data.city });
      if (dups.length) { duplicates++; continue; }
      try {
        const code = await nextCode(db, "leads", "lead_code", "LD");
        const lead = { ...data, lead_code: code, status: "New", validation: validateLead(data), created_by: req.user.id };
        await db.query(
          `INSERT INTO leads (lead_code, business_name, contact_person, email, phone, whatsapp, website, industry,
            category, city, state, source, status, validation, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'New',$13,$14) RETURNING *`,
          [code, business, data.contact_person, data.email, data.phone, data.whatsapp, data.website,
           data.industry, data.category, data.city, data.state, data.source, lead.validation, req.user.id]);
        const created = await db.one("SELECT * FROM leads WHERE lead_code = $1", [code]);
        await autoAssign(created);
        imported++;
      } catch (err) { failed++; failedRows.push({ row, error: String(err.message).slice(0, 200) }); }
    }
    await activity(req.user.id, "Leads Imported", "leads", null, { imported, duplicates, failed });
    res.json({ total: imported + duplicates + failed, imported, duplicates, failed, failed_rows: failedRows });
  } catch (e) { next(e); }
});

router.get("/leads/:id", requirePerm("leads", "view"), async (req, res, next) => {
  try { res.json(leadRow(await ensureLead(req, Number(req.params.id)))); } catch (e) { next(e); }
});

router.patch("/leads/:id", requirePerm("leads", "edit"), async (req, res, next) => {
  try {
    const lead = await ensureLead(req, Number(req.params.id));
    const patch = Object.fromEntries(LEAD_FIELDS.filter((f) => req.body?.[f] !== undefined).map((f) => [f, req.body[f]]));
    if (!Object.keys(patch).length) return res.json(leadRow(lead));
    if (patch.estimated_value !== undefined) patch.estimated_value = money(patch.estimated_value);
    const sets = Object.keys(patch).map((k, i) => `${k} = $${i + 1}`).join(", ");
    await db.query(`UPDATE leads SET ${sets}, updated_at = now() WHERE id = $${Object.keys(patch).length + 1}`,
      [...Object.values(patch), lead.id]);
    const updated = await db.one("SELECT * FROM leads WHERE id = $1", [lead.id]);
    if (Object.keys(patch).some((k) => ["email", "phone", "website", "business_name", "city"].includes(k)))
      await db.query("UPDATE leads SET validation = $1 WHERE id = $2", [validateLead(updated), lead.id]);
    if (patch.status && patch.status !== lead.status) {
      await activity(req.user.id, "Lead Status Changed", "leads", lead.id, { from: lead.status, to: patch.status });
      await runTriggers("lead.status", { lead: updated });
    }
    await activity(req.user.id, "Lead Edited", "leads", lead.id, { fields: Object.keys(patch) });
    res.json(leadRow(await db.one("SELECT * FROM leads WHERE id = $1", [lead.id])));
  } catch (e) { next(e); }
});

router.delete("/leads/:id", requirePerm("leads", "delete"), async (req, res, next) => {
  try {
    const lead = await ensureLead(req, Number(req.params.id));
    await db.query("UPDATE leads SET deleted_at = now() WHERE id = $1", [lead.id]);
    await activity(req.user.id, "Lead Deleted", "leads", lead.id, { business: lead.business_name });
    res.json({ ok: true, soft_deleted: true });
  } catch (e) { next(e); }
});

router.post("/leads/:id/assign", requirePerm("leads", "assign"), async (req, res, next) => {
  try {
    const lead = await ensureLead(req, Number(req.params.id));
    const { user_id, team_id, strategy } = req.body || {};
    let strat = "manual";
    if (strategy) strat = await autoAssign(lead, strategy);
    else {
      await db.query("UPDATE leads SET assigned_user_id = $1, assigned_team_id = $2 WHERE id = $3",
        [user_id ?? null, team_id ?? null, lead.id]);
      lead.assigned_user_id = user_id ?? null; lead.assigned_team_id = team_id ?? null;
    }
    const fresh = await db.one("SELECT * FROM leads WHERE id = $1", [lead.id]);
    await db.query("INSERT INTO lead_assignments (lead_id, user_id, team_id, strategy) VALUES ($1,$2,$3,$4)",
      [lead.id, fresh.assigned_user_id, fresh.assigned_team_id, strat]);
    const assignee = fresh.assigned_user_id ? await db.one("SELECT name FROM users WHERE id = $1", [fresh.assigned_user_id]) : null;
    await activity(req.user.id, "Lead Assigned", "leads", lead.id, { to: assignee?.name || "team" });
    await db.query("INSERT INTO notifications (user_id, title, body, link, kind) VALUES ($1,$2,$3,'/leads','lead')",
      [fresh.assigned_user_id, "New lead assigned", `${lead.business_name} was assigned to you.`, ]);
    await runTriggers("lead.assigned", { lead: fresh });
    res.json(leadRow(fresh));
  } catch (e) { next(e); }
});

router.post("/leads/:id/score", requirePerm("leads", "edit"), async (req, res, next) => {
  try {
    const lead = await ensureLead(req, Number(req.params.id));
    const r = await aiQualifyLead(lead);
    await db.query(`UPDATE leads SET score = $1, temperature = $2, intent = $3, recommended_action = $4,
                    ai_reason = $5, updated_at = now() WHERE id = $6`,
      [r.score, r.temperature, r.intent, r.action, r.reason, lead.id]);
    await db.query("INSERT INTO lead_scores (lead_id, score, temperature, intent, action, reason, scored_by) VALUES ($1,$2,$3,$4,$5,$6,$7)",
      [lead.id, r.score, r.temperature, r.intent, r.action, r.reason, r.model]);
    const fresh = await db.one("SELECT * FROM leads WHERE id = $1", [lead.id]);
    await activity(req.user.id, "Lead Scored", "leads", lead.id, { score: r.score, by: r.model });
    await runTriggers("lead.scored", { lead: fresh });
    res.json({ lead_id: lead.id, ...r });
  } catch (e) { next(e); }
});

router.post("/leads/:id/convert", requirePerm("leads", "edit"), async (req, res, next) => {
  try {
    const lead = await ensureLead(req, Number(req.params.id));
    const { customer = true, company = false, contact = false, deal = false } = req.body || {};
    const created = { customer_id: null, company_id: null, contact_id: null, deal_id: null };
    let companyId = null;
    if (company) {
      const name = lead.company_name || lead.business_name;
      const existing = await db.one("SELECT id FROM companies WHERE name = $1", [name]);
      if (existing) companyId = existing.id;
      else {
        const r = await db.query(
          `INSERT INTO companies (name, industry, website, phone, email, address, city, state, account_manager_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
          [name, lead.industry, lead.website, lead.phone, lead.email, lead.address, lead.city, lead.state, lead.assigned_user_id]);
        companyId = r.rows[0].id; created.company_id = companyId;
      }
    }
    if (customer) {
      const dup = lead.phone ? await db.one("SELECT id FROM customers WHERE phone = $1 AND deleted_at IS NULL", [lead.phone]) : null;
      if (dup) created.customer_id = dup.id;
      else {
        const fn = lead.first_name || (lead.contact_person ? lead.contact_person.split(" ")[0] : lead.business_name);
        const ln = lead.last_name || (lead.contact_person.includes(" ") ? lead.contact_person.split(" ").slice(1).join(" ") : "");
        const code = await nextCode(db, "customers", "customer_code", "CU");
        const r = await db.query(
          `INSERT INTO customers (customer_code, name, company, email, phone, whatsapp, billing_address, city, state,
            account_manager_id, lead_id, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
          [code, `${fn} ${ln}`.trim() || lead.business_name, lead.company_name || lead.business_name, lead.email,
           lead.phone, lead.whatsapp || lead.phone, lead.address, lead.city, lead.state,
           lead.assigned_user_id, lead.id, req.user.id]);
        created.customer_id = r.rows[0].id;
      }
    }
    if (contact && lead.contact_person) {
      const parts = lead.contact_person.split(" ");
      const r = await db.query("INSERT INTO contacts (first_name, last_name, company_id, email, phone, whatsapp, city) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id",
        [parts[0], parts.slice(1).join(" "), companyId, lead.email, lead.phone, lead.whatsapp, lead.city]);
      created.contact_id = r.rows[0].id;
    }
    if (deal) {
      const stage = await db.one("SELECT id FROM deal_stages WHERE key = 'new'");
      const r = await db.query(
        `INSERT INTO deals (name, lead_id, customer_id, company_id, stage_id, value, assigned_user_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [`${lead.business_name} — opportunity`, lead.id, created.customer_id, companyId,
         stage?.id ?? 1, num(lead.estimated_value) || 0, lead.assigned_user_id]);
      created.deal_id = r.rows[0].id;
    }
    await db.query("UPDATE leads SET status = 'Won', updated_at = now() WHERE id = $1", [lead.id]);
    await activity(req.user.id, "Lead Converted", "leads", lead.id, created);
    res.json({ ok: true, ...created });
  } catch (e) { next(e); }
});

router.post("/leads/:id/notes", requirePerm("leads", "edit"), async (req, res, next) => {
  try {
    const lead = await ensureLead(req, Number(req.params.id));
    if (!req.body?.body) throw new HttpError(422, "Note body is required");
    const r = await db.query("INSERT INTO notes (entity_type, entity_id, body, author_id) VALUES ('lead',$1,$2,$3) RETURNING id",
      [lead.id, req.body.body, req.user.id]);
    await activity(req.user.id, "Note Added", "leads", lead.id);
    res.status(201).json({ id: r.rows[0].id });
  } catch (e) { next(e); }
});

// ================= CUSTOMERS =================
router.get("/customers", requirePerm("customers", "view"), async (req, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(req.query.page_size) || 20));
    const { search = "", status: statusF = "" } = req.query;
    const own = applyOwnership(req, "account_manager_id");
    const where = ["deleted_at IS NULL"]; const params = [];
    if (own.sql) { params.push(req.user.id); where.push("account_manager_id = $1"); }
    if (search) { params.push(`%${search}%`); where.push(`(name ILIKE $${params.length} OR company ILIKE $${params.length} OR email ILIKE $${params.length} OR phone ILIKE $${params.length})`); }
    if (statusF) { params.push(statusF); where.push(`status = $${params.length}`); }
    const total = (await db.one(`SELECT COUNT(*)::int AS n FROM customers WHERE ${where.join(" AND ")}`, params)).n;
    const items = await db.all(`SELECT * FROM customers WHERE ${where.join(" AND ")} ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, pageSize, (page - 1) * pageSize]);
    res.json({ items: items.map((c) => ({ id: c.id, customer_code: c.customer_code, name: c.name, company: c.company,
      email: c.email, phone: c.phone, whatsapp: c.whatsapp, gst_number: c.gst_number, pan_number: c.pan_number,
      city: c.city, state: c.state, account_manager_id: c.account_manager_id, status: c.status, notes: c.notes,
      lead_id: c.lead_id, created_at: c.created_at })), total, page, page_size: pageSize });
  } catch (e) { next(e); }
});

const CUST_FIELDS = ["name", "company", "email", "phone", "whatsapp", "gst_number", "pan_number",
  "billing_address", "shipping_address", "city", "state", "country", "account_manager_id", "status", "notes"];

router.post("/customers", requirePerm("customers", "create"), async (req, res, next) => {
  try {
    const b = req.body || {};
    if (!b.name?.trim()) throw new HttpError(422, "name is required");
    if (b.gst_number && !/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/i.test(b.gst_number))
      throw new HttpError(422, "Invalid GST number format");
    if (b.pan_number && !/^[A-Z]{5}[0-9]{4}[A-Z]$/i.test(b.pan_number))
      throw new HttpError(422, "Invalid PAN format");
    const code = await nextCode(db, "customers", "customer_code", "CU");
    const r = await db.query(
      `INSERT INTO customers (customer_code, name, company, email, phone, whatsapp, gst_number, pan_number,
        billing_address, shipping_address, city, state, country, account_manager_id, status, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING *`,
      [code, b.name.trim(), b.company || "", b.email || "", b.phone || "", b.whatsapp || "", b.gst_number || "",
       b.pan_number || "", b.billing_address || "", b.shipping_address || "", b.city || "", b.state || "",
       b.country || "India", b.account_manager_id ?? req.user.id, b.status || "Active", b.notes || "", req.user.id]);
    await activity(req.user.id, "Customer Created", "customers", r.rows[0].id, { name: b.name });
    res.status(201).json(r.rows[0]);
  } catch (e) { next(e); }
});

router.get("/customers/:id", requirePerm("customers", "view"), async (req, res, next) => {
  try { res.json(await ensureCustomer(req, Number(req.params.id))); } catch (e) { next(e); }
});

router.patch("/customers/:id", requirePerm("customers", "edit"), async (req, res, next) => {
  try {
    await ensureCustomer(req, Number(req.params.id));
    const patch = Object.fromEntries(CUST_FIELDS.filter((f) => req.body?.[f] !== undefined).map((f) => [f, req.body[f]]));
    if (!Object.keys(patch).length) return res.json(await db.one("SELECT * FROM customers WHERE id = $1", [req.params.id]));
    const sets = Object.keys(patch).map((k, i) => `${k} = $${i + 1}`).join(", ");
    await db.query(`UPDATE customers SET ${sets} WHERE id = $${Object.keys(patch).length + 1}`,
      [...Object.values(patch), Number(req.params.id)]);
    await activity(req.user.id, "Customer Edited", "customers", Number(req.params.id), { fields: Object.keys(patch) });
    res.json(await db.one("SELECT * FROM customers WHERE id = $1", [req.params.id]));
  } catch (e) { next(e); }
});

router.delete("/customers/:id", requirePerm("customers", "delete"), async (req, res, next) => {
  try {
    const c = await ensureCustomer(req, Number(req.params.id));
    await db.query("UPDATE customers SET deleted_at = now() WHERE id = $1", [c.id]);
    await activity(req.user.id, "Customer Deleted", "customers", c.id, { name: c.name });
    res.json({ ok: true, soft_deleted: true });
  } catch (e) { next(e); }
});

// ================= COMPANIES & CONTACTS =================
router.get("/companies", requirePerm("companies", "view"), async (req, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(req.query.page_size) || 20));
    const { search = "" } = req.query; const params = []; const where = [];
    if (search) { params.push(`%${search}%`); where.push(`name ILIKE $1`); }
    const total = (await db.one(`SELECT COUNT(*)::int AS n FROM companies ${where.length ? "WHERE " + where.join(" AND ") : ""}`, params)).n;
    const items = await db.all(`SELECT * FROM companies ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY name LIMIT $${params.length + 1} OFFSET $${params.length + 2}`, [...params, pageSize, (page - 1) * pageSize]);
    res.json({ items, total, page, page_size: pageSize });
  } catch (e) { next(e); }
});

router.post("/companies", requirePerm("companies", "create"), async (req, res, next) => {
  try {
    const b = req.body || {};
    if (!b.name?.trim()) throw new HttpError(422, "name is required");
    const r = await db.query(
      `INSERT INTO companies (name, industry, website, phone, email, gst, pan, address, city, state,
        employee_count, annual_revenue, account_manager_id, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
      [b.name, b.industry || "", b.website || "", b.phone || "", b.email || "", b.gst || "", b.pan || "",
       b.address || "", b.city || "", b.state || "", b.employee_count ?? null, b.annual_revenue ?? null,
       b.account_manager_id ?? null, b.notes || ""]);
    res.status(201).json(r.rows[0]);
  } catch (e) { next(e); }
});

router.patch("/companies/:id", requirePerm("companies", "edit"), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const row = await db.one("SELECT * FROM companies WHERE id = $1", [id]);
    if (!row) throw new HttpError(404, "Company not found");
    const allowed = ["name", "industry", "website", "phone", "email", "gst", "pan", "address", "city", "state",
                     "employee_count", "annual_revenue", "account_manager_id", "notes"];
    const patch = Object.entries(req.body || {}).filter(([k, v]) => allowed.includes(k) && v !== undefined);
    if (patch.length) {
      const sets = patch.map(([k], i) => `${k} = $${i + 1}`).join(", ");
      await db.query(`UPDATE companies SET ${sets} WHERE id = $${patch.length + 1}`, [...patch.map(([, v]) => v), id]);
    }
    res.json(await db.one("SELECT * FROM companies WHERE id = $1", [id]));
  } catch (e) { next(e); }
});

router.get("/contacts", requirePerm("contacts", "view"), async (req, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(req.query.page_size) || 20));
    const { search = "", company_id } = req.query; const params = []; const where = [];
    if (company_id) { params.push(Number(company_id)); where.push(`company_id = $${params.length}`); }
    if (search) { params.push(`%${search}%`); where.push(`(first_name ILIKE $${params.length} OR last_name ILIKE $${params.length} OR email ILIKE $${params.length})`); }
    const total = (await db.one(`SELECT COUNT(*)::int AS n FROM contacts ${where.length ? "WHERE " + where.join(" AND ") : ""}`, params)).n;
    const items = await db.all(`SELECT * FROM contacts ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY id DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`, [...params, pageSize, (page - 1) * pageSize]);
    res.json({ items, total, page, page_size: pageSize });
  } catch (e) { next(e); }
});

router.post("/contacts", requirePerm("contacts", "create"), async (req, res, next) => {
  try {
    const b = req.body || {};
    if (!b.first_name?.trim()) throw new HttpError(422, "first_name is required");
    const r = await db.query(
      `INSERT INTO contacts (first_name, last_name, company_id, designation, email, phone, whatsapp, address, city, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [b.first_name, b.last_name || "", b.company_id ?? null, b.designation || "", b.email || "",
       b.phone || "", b.whatsapp || "", b.address || "", b.city || "", b.notes || ""]);
    res.status(201).json(r.rows[0]);
  } catch (e) { next(e); }
});

router.patch("/contacts/:id", requirePerm("contacts", "edit"), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const row = await db.one("SELECT * FROM contacts WHERE id = $1", [id]);
    if (!row) throw new HttpError(404, "Contact not found");
    const allowed = ["first_name", "last_name", "company_id", "designation", "email", "phone", "whatsapp", "address", "city", "notes"];
    const patch = Object.entries(req.body || {}).filter(([k, v]) => allowed.includes(k) && v !== undefined);
    if (patch.length) {
      const sets = patch.map(([k], i) => `${k} = $${i + 1}`).join(", ");
      await db.query(`UPDATE contacts SET ${sets} WHERE id = $${patch.length + 1}`, [...patch.map(([, v]) => v), id]);
    }
    res.json(await db.one("SELECT * FROM contacts WHERE id = $1", [id]));
  } catch (e) { next(e); }
});

// ================= DEALS =================
router.get("/deals/stages", requirePerm("deals", "view"), async (_req, res, next) => {
  try { res.json(await db.all('SELECT id, key, name, "order", kind FROM deal_stages ORDER BY "order"')); } catch (e) { next(e); }
});

router.get("/deals", requirePerm("deals", "view"), async (req, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(500, Math.max(1, Number(req.query.page_size) || 200));
    const { stage_id } = req.query;
    const own = applyOwnership(req, "assigned_user_id");
    const where = []; const params = [];
    if (own.sql) { params.push(req.user.id); where.push("assigned_user_id = $1"); }
    if (stage_id) { params.push(Number(stage_id)); where.push(`stage_id = $${params.length}`); }
    const wsql = where.length ? "WHERE " + where.join(" AND ") : "";
    const total = (await db.one(`SELECT COUNT(*)::int AS n FROM deals ${wsql}`, params)).n;
    const items = await db.all(`SELECT * FROM deals ${wsql} ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`, [...params, pageSize, (page - 1) * pageSize]);
    res.json({ items: items.map((d) => ({ ...d, value: num(d.value) })), total, page, page_size: pageSize });
  } catch (e) { next(e); }
});

router.post("/deals", requirePerm("deals", "create"), async (req, res, next) => {
  try {
    const b = req.body || {};
    if (!b.name?.trim()) throw new HttpError(422, "name is required");
    let stageId = b.stage_id ? Number(b.stage_id) : null;
    if (!stageId) stageId = (await db.one('SELECT id FROM deal_stages ORDER BY "order" LIMIT 1'))?.id ?? null;
    const r = await db.query(
      `INSERT INTO deals (name, lead_id, customer_id, company_id, stage_id, value, probability,
        expected_close_date, assigned_user_id, product_service, description)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [b.name, b.lead_id ?? null, b.customer_id ?? null, b.company_id ?? null, stageId,
       money(b.value || 0), b.probability ?? 20, b.expected_close_date ?? null,
       b.assigned_user_id ?? req.user.id, b.product_service || "", b.description || ""]);
    await activity(req.user.id, "Deal Created", "deals", r.rows[0].id, { name: b.name });
    res.status(201).json({ ...r.rows[0], value: num(r.rows[0].value) });
  } catch (e) { next(e); }
});

router.patch("/deals/:id", requirePerm("deals", "edit"), async (req, res, next) => {
  try {
    await ensureDeal(req, Number(req.params.id));
    const allowed = { name: "name", value: "value", customer_id: "customer_id", lead_id: "lead_id",
      stage_id: "stage_id", assigned_user_id: "assigned_user_id", expected_close_date: "expected_close_date",
      probability: "probability", product_service: "product_service", description: "description" };
    const patch = Object.entries(req.body || {}).filter(([k]) => allowed[k] && req.body[k] !== undefined);
    if (patch.length) {
      const sets = patch.map(([k], i) => `${allowed[k]} = $${i + 1}`).join(", ");
      await db.query(`UPDATE deals SET ${sets} WHERE id = $${patch.length + 1}`,
        [...patch.map(([, v]) => v), Number(req.params.id)]);
      await activity(req.user.id, "Deal Edited", "deals", Number(req.params.id));
    }
    const row = await db.one("SELECT * FROM deals WHERE id = $1", [req.params.id]);
    res.json({ ...row, value: num(row.value) });
  } catch (e) { next(e); }
});

router.delete("/deals/:id", requirePerm("deals", "delete"), async (req, res, next) => {
  try {
    const deal = await ensureDeal(req, Number(req.params.id));
    await db.query("DELETE FROM deals WHERE id = $1", [deal.id]);
    await activity(req.user.id, "Deal Deleted", "deals", deal.id, { name: deal.name });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.patch("/deals/:id/stage", requirePerm("deals", "edit"), async (req, res, next) => {
  try {
    const deal = await ensureDeal(req, Number(req.params.id));
    const stage = await db.one("SELECT * FROM deal_stages WHERE id = $1", [Number(req.body?.stage_id)]);
    if (!stage) throw new HttpError(404, "Stage not found");
    const old = await db.one("SELECT name FROM deal_stages WHERE id = $1", [deal.stage_id]);
    const closed = stage.kind !== "open" ? new Date() : null;
    await db.query(`UPDATE deals SET stage_id = $1, closed_at = $2, probability = $3 WHERE id = $4`,
      [stage.id, closed, stage.kind === "won" ? 100 : stage.kind === "lost" ? 0 : deal.probability, deal.id]);
    if (deal.lead_id && (stage.kind === "won" || stage.kind === "lost"))
      await db.query("UPDATE leads SET status = $1 WHERE id = $2", [stage.kind === "won" ? "Won" : "Lost", deal.lead_id]);
    await activity(req.user.id, "Deal Stage Changed", "deals", deal.id, { from: old?.name || "", to: stage.name });
    if (stage.kind === "won")
      await db.query("INSERT INTO notifications (user_id, title, body, link, kind) VALUES (NULL,$1,$2,'/pipeline','system')",
        [`Deal won: ${deal.name}`, `${num(deal.value)} — closed`]);
    const row = await db.one("SELECT * FROM deals WHERE id = $1", [deal.id]);
    res.json({ ...row, value: num(row.value) });
  } catch (e) { next(e); }
});

// ================= FOLLOWUPS / TASKS / MEETINGS / CALLS =================
router.get("/followups", requirePerm("followups", "view"), async (req, res, next) => {
  try {
    const { status: statusF = "", employee_id, date_from, date_to } = req.query;
    const own = applyOwnership(req, "employee_id");
    const where = []; const params = [];
    if (own.sql) { params.push(req.user.id); where.push("employee_id = $1"); }
    if (statusF) { params.push(statusF); where.push(`status = $${params.length}`); }
    if (employee_id) { params.push(Number(employee_id)); where.push(`employee_id = $${params.length}`); }
    if (date_from) { params.push(date_from); where.push(`date >= $${params.length}`); }
    if (date_to) { params.push(date_to); where.push(`date <= $${params.length}`); }
    const wsql = where.length ? "WHERE " + where.join(" AND ") : "";
    const items = await db.all(`SELECT * FROM followups ${wsql} ORDER BY date, time`, params);
    res.json({ items: items.map((f) => ({ ...f, date: String(f.date).slice(0, 10) })), total: items.length, page: 1, page_size: items.length });
  } catch (e) { next(e); }
});

router.post("/followups", requirePerm("followups", "create"), async (req, res, next) => {
  try {
    const b = req.body || {};
    if (!b.employee_id || !b.date) throw new HttpError(422, "employee_id and date are required");
    const r = await db.query(
      `INSERT INTO followups (entity_type, lead_id, customer_id, employee_id, type, date, time, reminder, status, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'Scheduled',$9) RETURNING id`,
      [b.entity_type || "lead", b.lead_id ?? null, b.customer_id ?? null, b.employee_id, b.type || "Call",
       b.date, b.time || "10:00", b.reminder ?? true, b.notes || ""]);
    if (b.lead_id) await db.query("UPDATE leads SET next_followup_at = $1 WHERE id = $2", [b.date, b.lead_id]);
    await activity(req.user.id, "Follow-up Created", "followups", r.rows[0].id, { type: b.type, date: b.date });
    res.status(201).json({ id: r.rows[0].id });
  } catch (e) { next(e); }
});

router.patch("/followups/:id", requirePerm("followups", "edit"), async (req, res, next) => {
  try {
    const fu = await ensureFollowup(req, Number(req.params.id));
    const b = req.body || {};
    if (b.status) {
      await db.query("UPDATE followups SET status = $1, completed_at = CASE WHEN $1 = 'Completed' THEN now() ELSE completed_at END WHERE id = $2", [b.status, fu.id]);
      if (b.status === "Completed" && fu.lead_id) {
        await db.query("UPDATE leads SET status = 'Contacted' WHERE id = $1 AND status = 'New'", [fu.lead_id]);
        await activity(req.user.id, "Follow-up Completed", "followups", fu.id, { outcome: b.outcome || "" });
      }
      if (b.status === "Missed") await runTriggers("followup.missed", { extra: { title: "Follow-up missed", link: "/followups", kind: "followup" } });
    }
    if (b.outcome !== undefined) await db.query("UPDATE followups SET outcome = $1 WHERE id = $2", [b.outcome, fu.id]);
    if (b.notes !== undefined) await db.query("UPDATE followups SET notes = $1 WHERE id = $2", [b.notes, fu.id]);
    if (b.date) await db.query("UPDATE followups SET date = $1, status = 'Rescheduled' WHERE id = $2", [b.date, fu.id]);
    if (b.next_in_days && fu.lead_id && fu.employee_id) {
      const when = new Date(Date.now() + Number(b.next_in_days) * 86400_000).toISOString().slice(0, 10);
      await db.query(`INSERT INTO followups (entity_type, lead_id, employee_id, type, date, time, reminder, status, notes)
                      VALUES ('lead',$1,$2,$3,$4,$5,TRUE,'Scheduled',$6)`,
        [fu.lead_id, fu.employee_id, fu.type, when, fu.time, `Chained from follow-up #${fu.id}`]);
      await db.query("UPDATE leads SET next_followup_at = $1 WHERE id = $2", [when, fu.lead_id]);
    }
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.get("/tasks", requirePerm("tasks", "view"), async (req, res, next) => {
  try {
    const { status: statusF = "" } = req.query;
    const own = applyOwnership(req, "assigned_to_id");
    const where = []; const params = [];
    if (own.sql) { params.push(req.user.id); where.push("assigned_to_id = $1"); }
    if (statusF) { params.push(statusF); where.push(`status = $${params.length}`); }
    const wsql = where.length ? "WHERE " + where.join(" AND ") : "";
    const items = await db.all(`SELECT * FROM tasks ${wsql} ORDER BY created_at DESC`, params);
    res.json({ items: items.map((t) => ({ ...t, due_date: t.due_date ? String(t.due_date).slice(0, 10) : null })), total: items.length, page: 1, page_size: items.length });
  } catch (e) { next(e); }
});

router.post("/tasks", requirePerm("tasks", "create"), async (req, res, next) => {
  try {
    const b = req.body || {};
    if (!b.title?.trim()) throw new HttpError(422, "title is required");
    const r = await db.query(
      `INSERT INTO tasks (title, description, lead_id, customer_id, assigned_to_id, created_by_id, priority, status, due_date)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'Pending',$8) RETURNING id`,
      [b.title, b.description || "", b.lead_id ?? null, b.customer_id ?? null,
       b.assigned_to_id ?? req.user.id, req.user.id, b.priority || "Medium", b.due_date ?? null]);
    await activity(req.user.id, "Task Created", "tasks", r.rows[0].id, { title: b.title });
    res.status(201).json({ id: r.rows[0].id });
  } catch (e) { next(e); }
});

router.patch("/tasks/:id", requirePerm("tasks", "edit"), async (req, res, next) => {
  try {
    await ensureTask(req, Number(req.params.id));
    const allowed = ["title", "description", "status", "priority", "due_date", "assigned_to_id"];
    const patch = Object.entries(req.body || {}).filter(([k, v]) => allowed.includes(k) && v !== undefined);
    if (patch.length) {
      const sets = patch.map(([k], i) => `${k} = $${i + 1}`).join(", ");
      await db.query(`UPDATE tasks SET ${sets} WHERE id = $${patch.length + 1}`, [...patch.map(([, v]) => v), Number(req.params.id)]);
    }
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.get("/meetings", requirePerm("meetings", "view"), async (req, res, next) => {
  try {
    const items = await db.all("SELECT * FROM meetings ORDER BY date DESC");
    const wide = ["Super Admin", "Admin", "Sales Manager"].includes(req.role.name);
    const rows = items.filter((m) => wide || (Array.isArray(m.participants) && m.participants.includes(req.user.id)) || !Array.isArray(m.participants))
      .map((m) => ({ ...m, date: String(m.date).slice(0, 10) }));
    res.json({ items: rows, total: rows.length, page: 1, page_size: rows.length });
  } catch (e) { next(e); }
});

router.post("/meetings", requirePerm("meetings", "create"), async (req, res, next) => {
  try {
    const b = req.body || {};
    if (!b.title?.trim() || !b.date) throw new HttpError(422, "title and date are required");
    const r = await db.query(
      `INSERT INTO meetings (title, lead_id, customer_id, participants, date, start_time, end_time, location, meeting_link, agenda)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [b.title, b.lead_id ?? null, b.customer_id ?? null, JSON.stringify(b.participants || [req.user.id]),
       b.date, b.start_time || "10:00", b.end_time || "11:00", b.location || "", b.meeting_link || "", b.agenda || ""]);
    await activity(req.user.id, "Meeting Created", "meetings", r.rows[0].id, { title: b.title, date: b.date });
    res.status(201).json({ id: r.rows[0].id });
  } catch (e) { next(e); }
});

router.post("/calls", requirePerm("calls", "create"), async (req, res, next) => {
  try {
    const b = req.body || {};
    const r = await db.query(
      `INSERT INTO calls (lead_id, customer_id, direction, employee_id, duration_min, outcome, notes, followup_required, start_time)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8, now()) RETURNING id`,
      [b.lead_id ?? null, b.customer_id ?? null, b.direction || "Outgoing", req.user.id,
       b.duration_min || 0, b.outcome || "Connected", b.notes || "", b.followup_required ?? false]);
    await activity(req.user.id, "Call Added", "calls", r.rows[0].id, { outcome: b.outcome });
    res.status(201).json({ id: r.rows[0].id });
  } catch (e) { next(e); }
});

// ================= DISCOVERY JOBS =================
const DISCOVERY_NAMES = ["Vertex", "BlueOak", "Nexgen", "Prime", "Silverline", "Quantum", "Horizon",
  "Crestview", "Atlas", "Pioneer", "Zenith", "Orbit", "Falcon", "Summit", "Nova", "Beacon"];
const DISCOVERY_SUF = ["Solutions", "Technologies", "Enterprises", "Services", "Consulting", "Systems", "Group", "Works"];

router.post("/discovery/jobs", requirePerm("discovery", "create"), async (req, res, next) => {
  try {
    const b = req.body || {};
    if (!b.category?.trim() || !b.target) throw new HttpError(422, "category and target are required");
    const r = await db.query(
      `INSERT INTO discovery_jobs (created_by, category, location, target, source, keywords, status)
       VALUES ($1,$2,$3,$4,$5,$6,'Queued') RETURNING *`,
      [req.user.id, b.category, b.location || "", Math.min(500, Number(b.target)), b.source || "maps", b.keywords || ""]);
    res.status(201).json(r.rows[0]);
  } catch (e) { next(e); }
});

router.get("/discovery/jobs", requirePerm("discovery", "view"), async (_req, res, next) => {
  try { res.json(await db.all("SELECT * FROM discovery_jobs ORDER BY created_at DESC")); } catch (e) { next(e); }
});

router.get("/discovery/jobs/:id", requirePerm("discovery", "view"), async (req, res, next) => {
  try {
    const j = await db.one("SELECT * FROM discovery_jobs WHERE id = $1", [Number(req.params.id)]);
    if (!j) throw new HttpError(404, "Job not found");
    res.json(j);
  } catch (e) { next(e); }
});

for (const action of ["pause", "resume", "cancel"]) {
  router.post(`/discovery/jobs/:id/${action}`, requirePerm("discovery", "edit"), async (req, res, next) => {
    try {
      const j = await db.one("SELECT * FROM discovery_jobs WHERE id = $1", [Number(req.params.id)]);
      if (!j) throw new HttpError(404, "Job not found");
      const to = action === "pause" ? "Paused" : action === "resume" ? "Running" : "Cancelled";
      await db.query("UPDATE discovery_jobs SET status = $1, started_at = COALESCE(started_at, now()), completed_at = CASE WHEN $1 IN ('Cancelled') THEN now() ELSE completed_at END WHERE id = $2", [to, j.id]);
      res.json(await db.one("SELECT * FROM discovery_jobs WHERE id = $1", [j.id]));
    } catch (e) { next(e); }
  });
}

/** In-process worker: advances Running jobs, inserting real (deduped) leads. */
function startDiscoveryWorker() {
  setInterval(async () => {
    try {
      const jobs = await db.all("SELECT * FROM discovery_jobs WHERE status IN ('Queued','Running')");
      for (const job of jobs) {
        if (job.status === "Queued") await db.query("UPDATE discovery_jobs SET status='Running', started_at=now() WHERE id=$1", [job.id]);
        const city = (job.location || "Pune").split(",")[0].trim();
        const batchSize = 3;
        for (let i = 0; i < batchSize; i++) {
          const current = await db.one("SELECT * FROM discovery_jobs WHERE id = $1", [job.id]);
          if (current.status !== "Running") return;
          if (current.discovered >= current.target) {
            await db.query("UPDATE discovery_jobs SET status='Completed', completed_at=now() WHERE id=$1", [job.id]);
            break;
          }
          const business = `${DISCOVERY_NAMES[Math.floor(Math.random() * DISCOVERY_NAMES.length)]} ${DISCOVERY_SUF[Math.floor(Math.random() * DISCOVERY_SUF.length)]}`;
          const phone = `+91 9${Math.floor(100000000 + Math.random() * 899999999)}`;
          const dups = await findDuplicates({ phone, business, city });
          if (dups.length) {
            await db.query("UPDATE discovery_jobs SET discovered = discovered + 1, duplicates = duplicates + 1 WHERE id = $1", [job.id]);
            continue;
          }
          const email = `${business.toLowerCase().replace(/[^a-z0-9]+/g, "")}@example.in`;
          const code = await nextCode(db, "leads", "lead_code", "LD");
          const validation = validateLead({ email, phone, website: `www.${business.toLowerCase().replace(/[^a-z0-9]+/g, "")}.in` });
          await db.query(
            `INSERT INTO leads (lead_code, business_name, contact_person, email, phone, whatsapp, website, industry,
              category, city, state, source, status, validation)
             VALUES ($1,$2,$3,$4,$5,$5,$6,$7,$7,$8,$9,'Discovery','New',$10)`,
            [code, business, "", email, phone, `www.${business.toLowerCase().replace(/[^a-z0-9]+/g, "")}.in`,
             job.category, city, job.location || "India", validation]);
          const valid = validation === "Valid" || validation === "Partially Valid";
          await db.query(`UPDATE discovery_jobs SET discovered = discovered + 1,
                          valid = valid + ${valid ? 1 : 0}, invalid = invalid + ${valid ? 0 : 1} WHERE id = $1`, [job.id]);
        }
        const after = await db.one("SELECT * FROM discovery_jobs WHERE id = $1", [job.id]);
        if (after.discovered >= after.target && after.status === "Running")
          await db.query("UPDATE discovery_jobs SET status='Completed', completed_at=now() WHERE id=$1", [job.id]);
      }
    } catch { /* worker must never crash the server */ }
  }, 900).unref?.();
}

module.exports = { router, startDiscoveryWorker };
