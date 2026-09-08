/**
 * Step 4 row-level views and assignment guards for existing CRM entities.
 * L1/L2 see all; L3 sees records owned by users in their department; L4 sees
 * their team; L5/L6 see their own records. This router is mounted before the
 * legacy CRM router so list/detail queries cannot leak cross-department data.
 */
const express = require("express");
const { db } = require("../db");
const { HttpError } = require("../core");
const { requireAuth, requirePerm } = require("../security");
const { scopedUserIds, isGlobalAdmin } = require("../workforce-scope");

const router = express.Router();
const num = (v) => (v === null || v === undefined ? v : Number(v));
const paged = (req, max = 200, fallback = 20) => ({
  page: Math.max(1, Number(req.query.page) || 1),
  pageSize: Math.min(max, Math.max(1, Number(req.query.page_size) || fallback)),
});

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

async function idsFor(req) {
  const ids = await scopedUserIds(req);
  return ids === null ? null : ids.filter(Number.isInteger);
}
const addOwnerScope = async (req, where, params, column) => {
  const ids = await idsFor(req);
  if (ids !== null) {
    params.push(ids);
    where.push(`${column} = ANY($${params.length}::int[])`);
  }
  return ids;
};

router.get("/leads", requirePerm("leads", "view"), async (req, res, next) => {
  try {
    const { page, pageSize } = paged(req);
    const { search = "", status: statusF = "", source = "", priority = "", city = "", owner = "",
      category = "", sort_by = "created_at", sort_order = "desc" } = req.query;
    const where = ["deleted_at IS NULL"]; const params = [];
    const visible = await addOwnerScope(req, where, params, "assigned_user_id");
    if (search) { params.push(`%${search}%`); where.push(`(business_name ILIKE $${params.length} OR contact_person ILIKE $${params.length} OR email ILIKE $${params.length} OR phone ILIKE $${params.length} OR city ILIKE $${params.length} OR lead_code ILIKE $${params.length})`); }
    if (statusF) { params.push(statusF); where.push(`status = $${params.length}`); }
    if (source) { params.push(source); where.push(`source = $${params.length}`); }
    if (priority) { params.push(priority); where.push(`priority = $${params.length}`); }
    if (city) { params.push(`%${city}%`); where.push(`city ILIKE $${params.length}`); }
    if (category) { params.push(category); where.push(`category = $${params.length}`); }
    if (owner) {
      const ownerId = Number(owner);
      if (visible !== null && !visible.includes(ownerId)) throw new HttpError(403, "Owner is outside your Workforce OS scope");
      params.push(ownerId); where.push(`assigned_user_id = $${params.length}`);
    }
    const sortCol = ["created_at", "business_name", "score", "estimated_value", "status", "city"].includes(sort_by) ? sort_by : "created_at";
    const dir = sort_order === "asc" ? "ASC" : "DESC";
    const total = (await db.one(`SELECT COUNT(*)::int AS n FROM leads WHERE ${where.join(" AND ")}`, params)).n;
    const items = await db.all(`SELECT * FROM leads WHERE ${where.join(" AND ")} ORDER BY ${sortCol} ${dir} NULLS LAST LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, pageSize, (page - 1) * pageSize]);
    res.json({ items: items.map(leadRow), total, page, page_size: pageSize });
  } catch (e) { next(e); }
});

router.get("/customers", requirePerm("customers", "view"), async (req, res, next) => {
  try {
    const { page, pageSize } = paged(req);
    const { search = "", status: statusF = "" } = req.query;
    const where = ["deleted_at IS NULL"]; const params = [];
    await addOwnerScope(req, where, params, "account_manager_id");
    if (search) { params.push(`%${search}%`); where.push(`(name ILIKE $${params.length} OR company ILIKE $${params.length} OR email ILIKE $${params.length} OR phone ILIKE $${params.length})`); }
    if (statusF) { params.push(statusF); where.push(`status = $${params.length}`); }
    const total = (await db.one(`SELECT COUNT(*)::int AS n FROM customers WHERE ${where.join(" AND ")}`, params)).n;
    const items = await db.all(`SELECT * FROM customers WHERE ${where.join(" AND ")} ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, pageSize, (page - 1) * pageSize]);
    res.json({ items, total, page, page_size: pageSize });
  } catch (e) { next(e); }
});

router.get("/companies", requirePerm("companies", "view"), async (req, res, next) => {
  try {
    const { page, pageSize } = paged(req);
    const { search = "" } = req.query;
    const where = []; const params = [];
    await addOwnerScope(req, where, params, "account_manager_id");
    if (search) { params.push(`%${search}%`); where.push(`name ILIKE $${params.length}`); }
    const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const total = (await db.one(`SELECT COUNT(*)::int AS n FROM companies ${w}`, params)).n;
    const items = await db.all(`SELECT * FROM companies ${w} ORDER BY name LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, pageSize, (page - 1) * pageSize]);
    res.json({ items, total, page, page_size: pageSize });
  } catch (e) { next(e); }
});

router.get("/contacts", requirePerm("contacts", "view"), async (req, res, next) => {
  try {
    const { page, pageSize } = paged(req);
    const { search = "" } = req.query;
    const ids = await idsFor(req); const params = []; const where = [];
    if (ids !== null) { params.push(ids); where.push(`c.account_manager_id = ANY($${params.length}::int[])`); }
    if (search) { params.push(`%${search}%`); where.push(`(ct.first_name ILIKE $${params.length} OR ct.last_name ILIKE $${params.length} OR ct.email ILIKE $${params.length} OR ct.phone ILIKE $${params.length})`); }
    const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const total = (await db.one(`SELECT COUNT(*)::int AS n FROM contacts ct LEFT JOIN companies c ON c.id = ct.company_id ${w}`, params)).n;
    const items = await db.all(`SELECT ct.* FROM contacts ct LEFT JOIN companies c ON c.id = ct.company_id ${w} ORDER BY ct.first_name LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, pageSize, (page - 1) * pageSize]);
    res.json({ items, total, page, page_size: pageSize });
  } catch (e) { next(e); }
});

router.get("/deals", requirePerm("deals", "view"), async (req, res, next) => {
  try {
    const { page, pageSize } = paged(req, 500, 200);
    const where = []; const params = [];
    await addOwnerScope(req, where, params, "assigned_user_id");
    if (req.query.stage_id) { params.push(Number(req.query.stage_id)); where.push(`stage_id = $${params.length}`); }
    const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const total = (await db.one(`SELECT COUNT(*)::int AS n FROM deals ${w}`, params)).n;
    const items = await db.all(`SELECT * FROM deals ${w} ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, pageSize, (page - 1) * pageSize]);
    res.json({ items: items.map((x) => ({ ...x, value: num(x.value) })), total, page, page_size: pageSize });
  } catch (e) { next(e); }
});

router.get("/followups", requirePerm("followups", "view"), async (req, res, next) => {
  try {
    const where = []; const params = [];
    const visible = await addOwnerScope(req, where, params, "employee_id");
    const { status: statusF = "", employee_id, date_from, date_to } = req.query;
    if (employee_id) {
      const eid = Number(employee_id);
      if (visible !== null && !visible.includes(eid)) throw new HttpError(403, "Employee is outside your Workforce OS scope");
      params.push(eid); where.push(`employee_id = $${params.length}`);
    }
    if (statusF) { params.push(statusF); where.push(`status = $${params.length}`); }
    if (date_from) { params.push(date_from); where.push(`date >= $${params.length}`); }
    if (date_to) { params.push(date_to); where.push(`date <= $${params.length}`); }
    const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
    res.json(await db.all(`SELECT * FROM followups ${w} ORDER BY date DESC, time DESC`, params));
  } catch (e) { next(e); }
});

router.get("/tasks", requirePerm("tasks", "view"), async (req, res, next) => {
  try {
    const where = []; const params = [];
    await addOwnerScope(req, where, params, "assigned_to_id");
    if (req.query.status) { params.push(req.query.status); where.push(`status = $${params.length}`); }
    const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
    res.json(await db.all(`SELECT * FROM tasks ${w} ORDER BY created_at DESC`, params));
  } catch (e) { next(e); }
});

router.get("/meetings", requirePerm("meetings", "view"), async (req, res, next) => {
  try {
    const ids = await idsFor(req); const params = []; const where = [];
    if (ids !== null) {
      params.push(ids.map(String));
      where.push(`EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(participants,'[]'::jsonb)) p(v) WHERE p.v = ANY($${params.length}::text[]))`);
    }
    if (req.query.date_from) { params.push(req.query.date_from); where.push(`date >= $${params.length}`); }
    if (req.query.date_to) { params.push(req.query.date_to); where.push(`date <= $${params.length}`); }
    const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
    res.json(await db.all(`SELECT * FROM meetings ${w} ORDER BY date DESC, start_time`, params));
  } catch (e) { next(e); }
});

router.get("/discovery/jobs", requirePerm("discovery", "view"), async (req, res, next) => {
  try {
    const ids = await idsFor(req);
    const rows = ids === null
      ? await db.all("SELECT * FROM discovery_jobs ORDER BY created_at DESC")
      : await db.all("SELECT * FROM discovery_jobs WHERE created_by = ANY($1::int[]) ORDER BY created_at DESC", [ids]);
    res.json(rows);
  } catch (e) { next(e); }
});

router.get("/discovery/jobs/:id", requirePerm("discovery", "view"), async (req, res, next) => {
  try {
    const row = await db.one("SELECT * FROM discovery_jobs WHERE id = $1", [Number(req.params.id)]);
    if (!row) throw new HttpError(404, "Job not found");
    const ids = await idsFor(req);
    if (ids !== null && !ids.includes(Number(row.created_by))) throw new HttpError(403, "This discovery job is outside your Workforce OS scope");
    res.json(row);
  } catch (e) { next(e); }
});

for (const action of ["pause", "resume", "cancel"]) {
  router.post(`/discovery/jobs/:id/${action}`, requirePerm("discovery", "edit"), async (req, res, next) => {
    try {
      const row = await db.one("SELECT * FROM discovery_jobs WHERE id = $1", [Number(req.params.id)]);
      if (!row) throw new HttpError(404, "Job not found");
      const ids = await idsFor(req);
      if (ids !== null && !ids.includes(Number(row.created_by))) throw new HttpError(403, "This discovery job is outside your Workforce OS scope");
      const to = action === "pause" ? "Paused" : action === "resume" ? "Running" : "Cancelled";
      await db.query("UPDATE discovery_jobs SET status = $1, started_at = COALESCE(started_at, now()), completed_at = CASE WHEN $1='Cancelled' THEN now() ELSE completed_at END WHERE id = $2", [to, row.id]);
      res.json(await db.one("SELECT * FROM discovery_jobs WHERE id = $1", [row.id]));
    } catch (e) { next(e); }
  });
}

// Validate assignment/ownership fields before legacy create/update handlers run.
async function assertAssignee(req, userId) {
  if (userId == null || userId === "") return;
  const id = Number(userId);
  const ids = await idsFor(req);
  if (ids !== null && !ids.includes(id)) throw new HttpError(403, "Selected employee is outside your Workforce OS scope");
}
const assignmentGuard = (field) => [requireAuth, async (req, _res, next) => {
  try { if (req.body && req.body[field] !== undefined) await assertAssignee(req, req.body[field]); next(); }
  catch (e) { next(e); }
}];
router.post("/leads", ...assignmentGuard("assigned_user_id"), (_req, _res, next) => next());
router.patch("/leads/:id", ...assignmentGuard("assigned_user_id"), (_req, _res, next) => next());
router.post("/customers", ...assignmentGuard("account_manager_id"), (_req, _res, next) => next());
router.patch("/customers/:id", ...assignmentGuard("account_manager_id"), (_req, _res, next) => next());
router.post("/companies", ...assignmentGuard("account_manager_id"), (_req, _res, next) => next());
router.patch("/companies/:id", ...assignmentGuard("account_manager_id"), (_req, _res, next) => next());
router.post("/deals", ...assignmentGuard("assigned_user_id"), (_req, _res, next) => next());
router.patch("/deals/:id", ...assignmentGuard("assigned_user_id"), (_req, _res, next) => next());
router.post("/tasks", ...assignmentGuard("assigned_to_id"), (_req, _res, next) => next());
router.patch("/tasks/:id", ...assignmentGuard("assigned_to_id"), (_req, _res, next) => next());
router.post("/followups", ...assignmentGuard("employee_id"), (_req, _res, next) => next());
router.patch("/followups/:id", ...assignmentGuard("employee_id"), (_req, _res, next) => next());

module.exports = router;
