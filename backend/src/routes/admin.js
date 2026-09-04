/**
 * Admin & analytics — users, roles, teams, automation, audit, settings,
 * notifications, dashboard (+widgets), reports, global search, AI endpoints.
 */
const express = require("express");
const { db } = require("../db");
const { HttpError, money } = require("../core");
const { requireAuth, requirePerm, MODULES, PERMS, SUPER_ROLES, hashPassword, applyOwnership, isWide } = require("../security");
const { runTriggers, ollamaPing, aiAssist, aiSettings, AI_UNAVAILABLE } = require("../engines");

const router = express.Router();
const audit = (user, action, target, detail = "") =>
  db.query("INSERT INTO audit_logs (user_id, user_name, action, target, detail) VALUES ($1,$2,$3,$4,$5)",
    [user?.id ?? null, user?.name ?? "system", action, target, detail]);
const num = (v) => (v === null || v === undefined ? v : Number(v));
const safeUser = (u) => { const { password_hash, ...rest } = u; return rest; };

// ================= USERS =================
router.get("/users", requirePerm("employees", "view"), async (_req, res, next) => {
  try { res.json((await db.all("SELECT * FROM users WHERE deleted_at IS NULL ORDER BY name")).map(safeUser)); } catch (e) { next(e); }
});

router.post("/users", requirePerm("employees", "create"), async (req, res, next) => {
  try {
    const b = req.body || {};
    if (!b.name?.trim() || !b.email?.trim()) throw new HttpError(422, "name and email are required");
    if (!b.password || String(b.password).length < 8) throw new HttpError(422, "password must be at least 8 characters");
    const email = b.email.toLowerCase();
    if (await db.one("SELECT id FROM users WHERE email = $1", [email])) throw new HttpError(409, "Email already exists");
    const r = await db.query(
      `INSERT INTO users (name, email, phone, password_hash, department, designation, role_id, team_id,
        reporting_manager_id, joining_date, is_sales, active, color)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [b.name, email, b.phone || "", hashPassword(b.password), b.department || "", b.designation || "",
       b.role_id, b.team_id ?? null, b.reporting_manager_id ?? null, b.joining_date ?? null,
       b.is_sales ?? false, b.active ?? true, b.color || "#0F766E"]);
    await audit(req.user, "User Created", `user:${email}`, b.name);
    res.status(201).json(safeUser(r.rows[0]));
  } catch (e) { next(e); }
});

router.patch("/users/:id", requirePerm("employees", "edit"), async (req, res, next) => {
  try {
    const u = await db.one("SELECT * FROM users WHERE id = $1", [Number(req.params.id)]);
    if (!u) throw new HttpError(404, "User not found");
    const allowed = ["name", "email", "phone", "department", "designation", "role_id", "team_id",
                     "reporting_manager_id", "joining_date", "is_sales", "active"];
    const patch = Object.entries(req.body || {}).filter(([k, v]) => allowed.includes(k) && v !== undefined);
    if (patch.length) {
      if (patch.some(([k]) => k === "email")) {
        const email = String(req.body.email).toLowerCase();
        if (await db.one("SELECT id FROM users WHERE email = $1 AND id <> $2", [email, u.id]))
          throw new HttpError(409, "Email already exists");
      }
      const sets = patch.map(([k], i) => `${k} = $${i + 1}`).join(", ");
      await db.query(`UPDATE users SET ${sets} WHERE id = $${patch.length + 1}`,
        [...patch.map(([k, v]) => (k === "email" ? String(v).toLowerCase() : v)), u.id]);
    }
    await audit(req.user, patch.some(([k]) => k === "active" && req.body.active === false) ? "User Disabled" : "User Updated", `user:${u.email}`, u.name);
    res.json(safeUser(await db.one("SELECT * FROM users WHERE id = $1", [u.id])));
  } catch (e) { next(e); }
});

router.delete("/users/:id", requirePerm("employees", "delete"), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (id === req.user.id) throw new HttpError(400, "You cannot delete your own account");
    const u = await db.one("SELECT * FROM users WHERE id = $1", [id]);
    if (!u) throw new HttpError(404, "User not found");
    await db.query("UPDATE users SET deleted_at = now(), active = FALSE WHERE id = $1", [id]);
    await audit(req.user, "User Deleted", `user:${u.email}`, u.name);
    res.json({ ok: true, soft_deleted: true });
  } catch (e) { next(e); }
});

// ================= ROLES & PERMISSIONS =================
router.get("/permissions", requireAuth, (_req, res) => res.json({ modules: MODULES, perms: PERMS }));

router.get("/roles", requirePerm("employees", "view"), async (_req, res, next) => {
  try { res.json(await db.all("SELECT * FROM roles ORDER BY id")); } catch (e) { next(e); }
});

router.post("/roles", requirePerm("employees", "create"), async (req, res, next) => {
  try {
    const b = req.body || {};
    if (!b.name?.trim()) throw new HttpError(422, "name is required");
    const r = await db.query("INSERT INTO roles (name, description, system, perms) VALUES ($1,$2,FALSE,$3) RETURNING *",
      [b.name, b.description || "", JSON.stringify({ dashboard: ["view"] })]);
    await audit(req.user, "Role Created", `role:${b.name}`);
    res.status(201).json(r.rows[0]);
  } catch (e) { next(e); }
});

router.patch("/roles/:id", requirePerm("employees", "edit"), async (req, res, next) => {
  try {
    const r = await db.one("SELECT * FROM roles WHERE id = $1", [Number(req.params.id)]);
    if (!r) throw new HttpError(404, "Role not found");
    if (req.body?.name) await db.query("UPDATE roles SET name = $1 WHERE id = $2", [req.body.name, r.id]);
    if (req.body?.description !== undefined) await db.query("UPDATE roles SET description = $1 WHERE id = $2", [req.body.description, r.id]);
    await audit(req.user, "Role Changed", `role:${req.body?.name || r.name}`);
    res.json(await db.one("SELECT * FROM roles WHERE id = $1", [r.id]));
  } catch (e) { next(e); }
});

router.put("/roles/:id/permissions", requirePerm("employees", "edit"), async (req, res, next) => {
  try {
    const r = await db.one("SELECT * FROM roles WHERE id = $1", [Number(req.params.id)]);
    if (!r) throw new HttpError(404, "Role not found");
    const cleaned = {};
    for (const [m, ps] of Object.entries(req.body?.perms || {}))
      if (MODULES.includes(m)) cleaned[m] = (ps || []).filter((p) => PERMS.includes(p));
    await db.query("UPDATE roles SET perms = $1 WHERE id = $2", [JSON.stringify(cleaned), r.id]);
    await audit(req.user, "Permission Changed", `role:${r.name}`, `${Object.keys(cleaned).length} modules`);
    res.json(await db.one("SELECT * FROM roles WHERE id = $1", [r.id]));
  } catch (e) { next(e); }
});

// ================= TEAMS =================
router.get("/teams", requirePerm("employees", "view"), async (_req, res, next) => {
  try {
    const teams = await db.all("SELECT * FROM teams ORDER BY id");
    const out = [];
    for (const t of teams) {
      const members = await db.all("SELECT id FROM users WHERE team_id = $1 AND deleted_at IS NULL", [t.id]);
      out.push({ ...t, member_ids: members.map((m) => m.id) });
    }
    res.json(out);
  } catch (e) { next(e); }
});

router.post("/teams", requirePerm("employees", "create"), async (req, res, next) => {
  try {
    const b = req.body || {};
    if (!b.name?.trim()) throw new HttpError(422, "name is required");
    const r = await db.query("INSERT INTO teams (name, focus) VALUES ($1,$2) RETURNING id", [b.name, b.focus || ""]);
    for (const uid of b.member_ids || []) await db.query("UPDATE users SET team_id = $1 WHERE id = $2", [r.rows[0].id, uid]);
    res.status(201).json({ id: r.rows[0].id });
  } catch (e) { next(e); }
});

router.patch("/teams/:id", requirePerm("employees", "edit"), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const team = await db.one("SELECT * FROM teams WHERE id = $1", [id]);
    if (!team) throw new HttpError(404, "Team not found");
    const b = req.body || {};
    if (b.name !== undefined || b.focus !== undefined) {
      await db.query("UPDATE teams SET name = $1, focus = $2 WHERE id = $3",
        [b.name !== undefined ? String(b.name).trim() : team.name, b.focus !== undefined ? String(b.focus) : team.focus, id]);
    }
    if (Array.isArray(b.member_ids)) {
      await db.query("UPDATE users SET team_id = NULL WHERE team_id = $1", [id]);
      for (const uid of b.member_ids) await db.query("UPDATE users SET team_id = $1 WHERE id = $2 AND deleted_at IS NULL", [id, Number(uid)]);
    }
    const members = await db.all("SELECT id FROM users WHERE team_id = $1 AND deleted_at IS NULL", [id]);
    const updated = await db.one("SELECT * FROM teams WHERE id = $1", [id]);
    await audit(req.user, "Team Updated", `team:${updated.name}`);
    res.json({ ...updated, member_ids: members.map((m) => m.id) });
  } catch (e) { next(e); }
});

// ================= AUTOMATION =================
router.get("/automation/rules", requirePerm("automation", "view"), async (_req, res, next) => {
  try { res.json(await db.all("SELECT * FROM automation_rules ORDER BY id")); } catch (e) { next(e); }
});

router.post("/automation/rules", requirePerm("automation", "create"), async (req, res, next) => {
  try {
    const b = req.body || {};
    if (!b.name?.trim() || !b.trigger) throw new HttpError(422, "name and trigger are required");
    const r = await db.query(
      `INSERT INTO automation_rules (name, trigger, cond_field, cond_op, cond_value, actions, enabled)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [b.name, b.trigger, b.cond_field || "", b.cond_op || "eq", b.cond_value || "",
       JSON.stringify(b.actions || []), b.enabled ?? true]);
    await audit(req.user, "Automation Rule Created", b.name);
    res.status(201).json({ id: r.rows[0].id });
  } catch (e) { next(e); }
});

router.patch("/automation/rules/:id", requirePerm("automation", "edit"), async (req, res, next) => {
  try {
    const r = await db.one("SELECT * FROM automation_rules WHERE id = $1", [Number(req.params.id)]);
    if (!r) throw new HttpError(404, "Rule not found");
    const b = req.body || {};
    const fields = { name: b.name, trigger: b.trigger, cond_field: b.cond_field, cond_op: b.cond_op,
                     cond_value: b.cond_value, enabled: b.enabled };
    for (const [k, v] of Object.entries(fields)) if (v !== undefined) await db.query(`UPDATE automation_rules SET ${k} = $1 WHERE id = $2`, [v, r.id]);
    if (b.actions) await db.query("UPDATE automation_rules SET actions = $1 WHERE id = $2", [JSON.stringify(b.actions), r.id]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.delete("/automation/rules/:id", requirePerm("automation", "delete"), async (req, res, next) => {
  try {
    await db.query("DELETE FROM automation_rules WHERE id = $1", [Number(req.params.id)]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.get("/automation/executions", requirePerm("automation", "view"), async (_req, res, next) => {
  try { res.json(await db.all("SELECT * FROM automation_executions ORDER BY created_at DESC LIMIT 100")); } catch (e) { next(e); }
});

// ================= AUDIT =================
router.get("/audit-logs", requirePerm("audit", "view"), async (req, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(req.query.page_size) || 50));
    const { search = "" } = req.query;
    const where = []; const params = [];
    if (search) { params.push(`%${search}%`); where.push(`(action ILIKE $1 OR user_name ILIKE $1 OR target ILIKE $1)`); }
    const wsql = where.length ? "WHERE " + where.join(" AND ") : "";
    const total = (await db.one(`SELECT COUNT(*)::int AS n FROM audit_logs ${wsql}`, params)).n;
    const items = await db.all(`SELECT * FROM audit_logs ${wsql} ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, pageSize, (page - 1) * pageSize]);
    res.json({ items, total, page, page_size: pageSize });
  } catch (e) { next(e); }
});

// ================= SETTINGS =================
router.get("/settings", requireAuth, async (_req, res, next) => {
  try {
    const rows = await db.all("SELECT key, value FROM crm_settings");
    const out = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    const templates = await db.all("SELECT * FROM message_templates ORDER BY id");
    out.templates = templates;
    res.json(out);
  } catch (e) { next(e); }
});

router.put("/settings", requirePerm("settings", "edit"), async (req, res, next) => {
  try {
    for (const key of ["company", "ai", "scoring", "assignment"]) {
      if (req.body?.[key]) {
        const existing = await db.one("SELECT value FROM crm_settings WHERE key = $1", [key]);
        const merged = { ...(existing?.value || {}), ...req.body[key] };
        await db.query(`INSERT INTO crm_settings (key, value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value = $2`,
          [key, JSON.stringify(merged)]);
      }
    }
    if (Array.isArray(req.body?.templates)) {
      for (const t of req.body.templates) {
        if (t.id) await db.query("UPDATE message_templates SET name = $1, subject = $2, body = $3 WHERE id = $4",
          [t.name, t.subject || "", t.body || "", Number(t.id)]);
        else await db.query("INSERT INTO message_templates (channel, name, subject, body) VALUES ($1,$2,$3,$4)",
          [t.channel || "whatsapp", t.name || "", t.subject || "", t.body || ""]);
      }
    }
    await audit(req.user, "Settings Changed", "crm_settings");
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.post("/settings/templates", requirePerm("settings", "edit"), async (req, res, next) => {
  try {
    const b = req.body || {};
    const r = await db.query("INSERT INTO message_templates (channel, name, subject, body) VALUES ($1,$2,$3,$4) RETURNING id",
      [b.channel || "whatsapp", b.name || "", b.subject || "", b.body || ""]);
    res.status(201).json({ id: r.rows[0].id });
  } catch (e) { next(e); }
});

// ================= NOTIFICATIONS =================
async function visibleNotifications(userId, wide) {
  return wide
    ? db.all("SELECT * FROM notifications ORDER BY created_at DESC LIMIT 100")
    : db.all("SELECT * FROM notifications WHERE user_id = $1 OR user_id IS NULL ORDER BY created_at DESC LIMIT 100", [userId]);
}
router.get("/notifications", requireAuth, async (req, res, next) => {
  try { res.json(await visibleNotifications(req.user.id, isWide(req.role))); } catch (e) { next(e); }
});
router.get("/notifications/unread", requireAuth, async (req, res, next) => {
  try {
    const rows = await visibleNotifications(req.user.id, isWide(req.role));
    res.json({ count: rows.filter((n) => !n.read).length });
  } catch (e) { next(e); }
});
router.patch("/notifications/:id/read", requireAuth, async (req, res, next) => {
  try { await db.query("UPDATE notifications SET read = TRUE WHERE id = $1", [Number(req.params.id)]); res.json({ ok: true }); } catch (e) { next(e); }
});
router.post("/notifications/read-all", requireAuth, async (req, res, next) => {
  try {
    const rows = await visibleNotifications(req.user.id, isWide(req.role));
    for (const n of rows) await db.query("UPDATE notifications SET read = TRUE WHERE id = $1", [n.id]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ================= DASHBOARD =================
router.get("/dashboard", requirePerm("dashboard", "view"), async (req, res, next) => {
  try {
    const range = req.query.range || "month";
    const now = new Date();
    const start = { today: new Date(now.toDateString()),
      week: new Date(Date.now() - 7 * 86400_000),
      month: new Date(now.getFullYear(), now.getMonth(), 1),
      quarter: new Date(Date.now() - 90 * 86400_000),
      year: new Date(now.getFullYear(), 0, 1) }[range] || new Date(now.getFullYear(), now.getMonth(), 1);
    const own = applyOwnership(req, "assigned_user_id");
    const ownSql = own.sql ? "AND assigned_user_id = $1" : "";
    const ownParams = own.sql ? [req.user.id] : [];
    const leads = await db.all(`SELECT * FROM leads WHERE deleted_at IS NULL ${ownSql}`, ownParams);
    const stages = await db.all('SELECT * FROM deal_stages ORDER BY "order"');
    const deals = await db.all("SELECT * FROM deals");
    const kindOf = (id) => stages.find((s) => s.id === id)?.kind || "open";
    const open = deals.filter((d) => kindOf(d.stage_id) === "open");
    const won = deals.filter((d) => kindOf(d.stage_id) === "won");
    const lost = deals.filter((d) => kindOf(d.stage_id) === "lost");
    const revenue = (await db.one("SELECT COALESCE(SUM(amount),0)::float AS v FROM payments WHERE payment_date >= $1", [start])).v;
    const invoiced = (await db.one("SELECT COALESCE(SUM(grand_total),0)::float AS v FROM invoices")).v;
    const paid = (await db.one("SELECT COALESCE(SUM(paid_amount),0)::float AS v FROM invoices")).v;
    const expenses = (await db.one("SELECT COALESCE(SUM(amount),0)::float AS v FROM expenses WHERE date >= $1", [start])).v;
    const today = now.toISOString().slice(0, 10);
    const count = async (sql, params = []) => (await db.one(sql, params)).n;
    const converted = leads.filter((l) => l.status === "Won").length;
    const byMonth = [];
    for (let back = 5; back >= 0; back--) {
      const d0 = new Date(now.getFullYear(), now.getMonth() - back, 1);
      const d1 = new Date(now.getFullYear(), now.getMonth() - back + 1, 1);
      byMonth.push({ month: d0.toLocaleString("en", { month: "short" }),
        leads: leads.filter((l) => new Date(l.created_at) >= d0 && new Date(l.created_at) < d1).length });
    }
    res.json({
      total_leads: leads.length,
      new_leads: leads.filter((l) => l.status === "New").length,
      hot_leads: leads.filter((l) => l.temperature === "Hot" && !["Won", "Lost"].includes(l.status)).length,
      qualified_leads: leads.filter((l) => ["Qualified", "Proposal", "Negotiation"].includes(l.status)).length,
      converted_leads: converted,
      lost_leads: leads.filter((l) => l.status === "Lost").length,
      total_customers: await count("SELECT COUNT(*)::int AS n FROM customers WHERE deleted_at IS NULL"),
      pipeline_value: money(open.reduce((a, d) => a + Number(d.value), 0)),
      won_revenue: money(won.reduce((a, d) => a + Number(d.value), 0)),
      monthly_revenue: money(revenue),
      outstanding: money(invoiced - paid),
      expenses: money(expenses),
      profit_estimate: money(revenue - expenses),
      tasks_due: await count("SELECT COUNT(*)::int AS n FROM tasks WHERE status IN ('Pending','In Progress')"),
      overdue_tasks: await count("SELECT COUNT(*)::int AS n FROM tasks WHERE status IN ('Pending','In Progress') AND due_date < $1", [today]),
      followups_today: await count("SELECT COUNT(*)::int AS n FROM followups WHERE date = $1 AND status = 'Scheduled'", [today]),
      overdue_followups: await count("SELECT COUNT(*)::int AS n FROM followups WHERE status IN ('Scheduled','Missed') AND date < $1", [today]),
      meetings_today: await count("SELECT COUNT(*)::int AS n FROM meetings WHERE date = $1", [today]),
      conversion_rate: leads.length ? Math.round(converted / leads.length * 1000) / 10 : 0,
      win_rate: (won.length + lost.length) ? Math.round(won.length / (won.length + lost.length) * 1000) / 10 : 0,
      avg_deal_size: won.length ? money(won.reduce((a, d) => a + Number(d.value), 0) / won.length) : 0,
      pipeline_by_stage: stages.filter((s) => s.kind === "open").map((s) => ({
        stage: s.name, value: money(open.filter((d) => d.stage_id === s.id).reduce((a, d) => a + Number(d.value), 0)),
        count: open.filter((d) => d.stage_id === s.id).length })),
      leads_by_month: byMonth,
    });
  } catch (e) { next(e); }
});

router.get("/dashboard/hot-leads", requirePerm("dashboard", "view"), async (req, res, next) => {
  try {
    const own = applyOwnership(req, "assigned_user_id");
    const rows = await db.all(
      `SELECT * FROM leads WHERE deleted_at IS NULL AND temperature = 'Hot' AND status NOT IN ('Won','Lost')
       ${own.sql ? "AND assigned_user_id = $1" : ""} ORDER BY score DESC NULLS LAST LIMIT 6`,
      own.sql ? [req.user.id] : []);
    res.json(rows.map((l) => ({ id: l.id, business_name: l.business_name, city: l.city, industry: l.industry,
      score: l.score, estimated_value: num(l.estimated_value), recommended_action: l.recommended_action })));
  } catch (e) { next(e); }
});

router.get("/dashboard/agenda", requireAuth, async (req, res, next) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const own = applyOwnership(req, "employee_id");
    const fus = await db.all(`SELECT * FROM followups WHERE date = $1 AND status = 'Scheduled' ${own.sql ? "AND employee_id = $2" : ""} ORDER BY time`,
      own.sql ? [today, req.user.id] : [today]);
    const meets = await db.all("SELECT * FROM meetings WHERE date = $1 ORDER BY start_time", [today]);
    const ename = async (type, id) => {
      if (!id) return "—";
      if (type === "lead") return (await db.one("SELECT business_name FROM leads WHERE id = $1", [id]))?.business_name || "—";
      return (await db.one("SELECT company FROM customers WHERE id = $1", [id]))?.company || "—";
    };
    const followups = [];
    for (const f of fus) {
      const eid = f.entity_type === "lead" ? f.lead_id : f.customer_id;
      const emp = await db.one("SELECT name FROM users WHERE id = $1", [f.employee_id]);
      followups.push({ id: f.id, type: f.type, time: f.time, entity_type: f.entity_type, entity_id: eid,
        name: await ename(f.entity_type, eid), employee: emp?.name || "" });
    }
    res.json({ followups, meetings: meets.map((m) => ({ id: m.id, title: m.title, start: m.start_time,
      end: m.end_time, location: m.location })) });
  } catch (e) { next(e); }
});

router.get("/dashboard/activity", requireAuth, async (_req, res, next) => {
  try {
    const rows = await db.all("SELECT * FROM activities ORDER BY created_at DESC LIMIT 14");
    const out = [];
    for (const a of rows) {
      const u = a.actor_id ? await db.one("SELECT name FROM users WHERE id = $1", [a.actor_id]) : null;
      out.push({ id: a.id, user: u?.name || "System", action: a.action,
        detail: a.meta?.business || a.meta?.name || a.meta?.title || "", at: a.created_at });
    }
    res.json(out);
  } catch (e) { next(e); }
});

// ================= REPORTS =================
router.get("/reports/leads", requirePerm("reports", "view"), async (req, res, next) => {
  try {
    const own = applyOwnership(req, "assigned_user_id");
    const where = ["deleted_at IS NULL"]; const params = [];
    if (own.sql) { params.push(req.user.id); where.push("assigned_user_id = $1"); }
    if (req.query.status) { params.push(req.query.status); where.push(`status = $${params.length}`); }
    if (req.query.source) { params.push(req.query.source); where.push(`source = $${params.length}`); }
    if (req.query.city) { params.push(`%${req.query.city}%`); where.push(`city ILIKE $${params.length}`); }
    const leads = await db.all(`SELECT * FROM leads WHERE ${where.join(" AND ")}`, params);
    const by = (k) => leads.reduce((m, l) => ((m[l[k] || "—"] = (m[l[k] || "—"] || 0) + 1), m), {});
    res.json({ total: leads.length, by_status: by("status"), by_source: by("source"), by_priority: by("priority"),
      avg_score: leads.length ? Math.round(leads.reduce((a, l) => a + (l.score || 0), 0) / leads.length * 10) / 10 : 0,
      total_estimated_value: money(leads.reduce((a, l) => a + Number(l.estimated_value || 0), 0)) });
  } catch (e) { next(e); }
});

router.get("/reports/sales", requirePerm("reports", "view"), async (_req, res, next) => {
  try {
    const stages = await db.all("SELECT * FROM deal_stages");
    const deals = await db.all("SELECT * FROM deals");
    const kindOf = (id) => stages.find((s) => s.id === id)?.kind || "open";
    const won = deals.filter((d) => kindOf(d.stage_id) === "won");
    const lost = deals.filter((d) => kindOf(d.stage_id) === "lost");
    const open = deals.filter((d) => kindOf(d.stage_id) === "open");
    res.json({ open_deals: open.length, open_value: money(open.reduce((a, d) => a + Number(d.value), 0)),
      won_deals: won.length, won_value: money(won.reduce((a, d) => a + Number(d.value), 0)),
      lost_deals: lost.length,
      win_rate: (won.length + lost.length) ? Math.round(won.length / (won.length + lost.length) * 1000) / 10 : 0,
      avg_deal_size: won.length ? money(won.reduce((a, d) => a + Number(d.value), 0) / won.length) : 0 });
  } catch (e) { next(e); }
});

router.get("/reports/payments", requirePerm("reports", "view"), async (_req, res, next) => {
  try {
    const invoices = await db.all("SELECT * FROM invoices");
    const payments = await db.all("SELECT * FROM payments");
    const methods = ["Cash", "UPI", "Bank Transfer", "Credit Card", "Debit Card", "Cheque", "Other"];
    res.json({
      total_invoiced: money(invoices.reduce((a, i) => a + Number(i.grand_total), 0)),
      total_collected: money(payments.reduce((a, p) => a + Number(p.amount), 0)),
      total_outstanding: money(invoices.reduce((a, i) => a + Number(i.balance_due), 0)),
      overdue_invoices: invoices.filter((i) => i.status === "Overdue").length,
      by_method: Object.fromEntries(methods.map((m) => [m, money(payments.filter((p) => p.payment_method === m).reduce((a, p) => a + Number(p.amount), 0))])),
      outstanding: invoices.filter((i) => Number(i.balance_due) > 0 && !["Draft", "Cancelled"].includes(i.status))
        .map((i) => ({ invoice_number: i.invoice_number, customer_id: i.customer_id,
          grand_total: num(i.grand_total), paid: num(i.paid_amount), balance: num(i.balance_due),
          due_date: String(i.due_date).slice(0, 10), status: i.status })),
    });
  } catch (e) { next(e); }
});

router.get("/reports/performance", requirePerm("reports", "view"), async (_req, res, next) => {
  try {
    const users = await db.all("SELECT * FROM users WHERE is_sales AND deleted_at IS NULL");
    const stages = await db.all("SELECT * FROM deal_stages");
    const rows = [];
    for (const u of users) {
      const leads = await db.all("SELECT * FROM leads WHERE assigned_user_id = $1 AND deleted_at IS NULL", [u.id]);
      const deals = await db.all("SELECT * FROM deals WHERE assigned_user_id = $1", [u.id]);
      const won = deals.filter((d) => stages.find((s) => s.id === d.stage_id)?.kind === "won");
      const converted = leads.filter((l) => l.status === "Won").length;
      rows.push({ user_id: u.id, name: u.name, assigned_leads: leads.length, converted,
        conversion_rate: leads.length ? Math.round(converted / leads.length * 1000) / 10 : 0,
        deals_won: won.length, revenue: money(won.reduce((a, d) => a + Number(d.value), 0)),
        followups_completed: (await db.one("SELECT COUNT(*)::int AS n FROM followups WHERE employee_id = $1 AND status = 'Completed'", [u.id])).n,
        followups_overdue: (await db.one("SELECT COUNT(*)::int AS n FROM followups WHERE employee_id = $1 AND status IN ('Missed','Scheduled') AND date < CURRENT_DATE", [u.id])).n });
    }
    res.json(rows);
  } catch (e) { next(e); }
});

// ================= SEARCH =================
router.get("/search", requireAuth, async (req, res, next) => {
  try {
    const q = String(req.query.q || "").trim();
    if (!q) return res.json({ leads: [], customers: [], companies: [], contacts: [], deals: [], quotations: [], invoices: [] });
    const like = `%${q}%`;
    const [leads, customers, companies, contacts, deals, quotations, invoices] = await Promise.all([
      db.all("SELECT id, business_name, city FROM leads WHERE deleted_at IS NULL AND (business_name ILIKE $1 OR email ILIKE $1 OR phone ILIKE $1 OR contact_person ILIKE $1) LIMIT 5", [like]),
      db.all("SELECT id, name, company, city FROM customers WHERE deleted_at IS NULL AND (name ILIKE $1 OR company ILIKE $1 OR email ILIKE $1) LIMIT 5", [like]),
      db.all("SELECT id, name, industry FROM companies WHERE name ILIKE $1 OR industry ILIKE $1 LIMIT 5", [like]),
      db.all("SELECT id, first_name, last_name, designation, email FROM contacts WHERE first_name ILIKE $1 OR last_name ILIKE $1 OR email ILIKE $1 LIMIT 5", [like]),
      db.all("SELECT id, name, value FROM deals WHERE name ILIKE $1 LIMIT 5", [like]),
      db.all("SELECT id, quotation_number, status FROM quotations WHERE quotation_number ILIKE $1 LIMIT 5", [like]),
      db.all("SELECT id, invoice_number, status FROM invoices WHERE invoice_number ILIKE $1 LIMIT 5", [like]),
    ]);
    res.json({
      leads: leads.map((x) => ({ id: x.id, label: x.business_name, sub: x.city || "" })),
      customers: customers.map((x) => ({ id: x.id, label: x.company || x.name, sub: x.city || "" })),
      companies: companies.map((x) => ({ id: x.id, label: x.name, sub: x.industry || "" })),
      contacts: contacts.map((x) => ({ id: x.id, label: `${x.first_name} ${x.last_name}`.trim(), sub: x.designation || "" })),
      deals: deals.map((x) => ({ id: x.id, label: x.name, sub: String(num(x.value)) })),
      quotations: quotations.map((x) => ({ id: x.id, label: x.quotation_number, sub: x.status })),
      invoices: invoices.map((x) => ({ id: x.id, label: x.invoice_number, sub: x.status })),
    });
  } catch (e) { next(e); }
});

// ================= AI =================
router.post("/ai/test", requireAuth, async (_req, res, next) => {
  try { res.json(await ollamaPing(await aiSettings())); } catch (e) { next(e); }
});

router.post("/ai/lead-summary", requirePerm("ai", "view"), async (req, res, next) => {
  try {
    const lead = await db.one("SELECT * FROM leads WHERE id = $1", [Number(req.body?.lead_id)]);
    if (!lead) throw new HttpError(404, "Lead not found");
    const fallback = `${lead.business_name} is a ${lead.city || "India"}-based ${lead.industry || lead.category || "business"} ` +
      `from ${lead.source}. Contact: ${lead.phone ? "phone ✓ " : ""}${lead.email ? "email ✓ " : ""}${lead.website ? "website ✓" : ""}. ` +
      `Score ${lead.score ?? "—"}/100, ${lead.temperature || "unqualified"}. Recommended: ${lead.recommended_action || "qualify the lead"}.`;
    const prompt = `Summarize this CRM lead in 3 short sentences, then one recommended next step.\n` +
      `Business: ${lead.business_name}; industry: ${lead.industry}; city: ${lead.city}; score: ${lead.score}; ` +
      `temperature: ${lead.temperature}; source: ${lead.source}.`;
    res.json(await aiAssist("lead-summary", prompt, fallback));
  } catch (e) { next(e); }
});

router.post("/ai/next-action", requirePerm("ai", "view"), async (req, res, next) => {
  try {
    const lead = await db.one("SELECT * FROM leads WHERE id = $1", [Number(req.body?.lead_id)]);
    if (!lead) throw new HttpError(404, "Lead not found");
    const fallback = `Recommended: ${lead.recommended_action || "Call"} — ${lead.ai_reason || "based on the current lead score and engagement history."}`;
    const prompt = `Recommend exactly one next best action from: Call today, Send WhatsApp, Send proposal, ` +
      `Schedule demo, Follow-up later, Close as lost. One-line reason.\nLead: ${lead.business_name}; ` +
      `status: ${lead.status}; score: ${lead.score}; temperature: ${lead.temperature}.`;
    res.json(await aiAssist("next-action", prompt, fallback));
  } catch (e) { next(e); }
});

router.post("/ai/ask", requirePerm("ai", "view"), async (req, res, next) => {
  try {
    const promptIn = String(req.body?.prompt || "").slice(0, 1500);
    if (!promptIn) throw new HttpError(422, "prompt is required");
    const [lc, cc, pv] = await Promise.all([
      db.one("SELECT COUNT(*)::int AS n FROM leads WHERE deleted_at IS NULL"),
      db.one("SELECT COUNT(*)::int AS n FROM customers WHERE deleted_at IS NULL"),
      db.one("SELECT COALESCE(SUM(value),0)::float AS v FROM deals"),
    ]);
    const fallback = `${AI_UNAVAILABLE} Quick facts from your database: ${lc.n} leads, ${cc.n} customers, ` +
      `pipeline ₹${money(pv.v).toLocaleString("en-IN")}. I can summarise a specific lead from its detail page ` +
      `(“Generate AI summary”) or recommend its next best action.`;
    const prompt = `You are the sales AI assistant inside ITCT CRM (IT Cyber Technologies Pvt Ltd). ` +
      `CRM facts: ${lc.n} leads, ${cc.n} customers, pipeline value ₹${money(pv.v)}. ` +
      `Answer briefly and practically.\nQuestion: ${promptIn}`;
    res.json(await aiAssist("assistant", prompt, fallback));
  } catch (e) { next(e); }
});

module.exports = router;
