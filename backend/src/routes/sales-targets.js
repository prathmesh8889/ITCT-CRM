/**
 * Sales targets — manager-assigned goals with strict self-only visibility for sales reps.
 * CEO/Director/global admins may manage the whole sales department. Sales Manager
 * may manage subordinate sales staff. Sales reps only receive their own rows + metrics.
 */
const express = require("express");
const { db } = require("../db");
const { HttpError, money } = require("../core");
const { requireAuth } = require("../security");
const { norm, isGlobalAdmin, isSalesAssignmentAuthority } = require("../workforce-scope");

const router = express.Router();
const SALES_DEPT = "sales & business development";
const num = (v) => (v === null || v === undefined ? 0 : Number(v));

const isSalesUser = (u) =>
  !!u && !u.deleted_at && (norm(u.department) === SALES_DEPT || u.is_sales === true);

const canViewTargets = (req) =>
  isSalesAssignmentAuthority(req) || isSalesUser(req.user);

async function eligibleUsers(req) {
  if (!isSalesAssignmentAuthority(req)) return [];
  const rows = await db.all(`
    SELECT u.id, u.name, u.email, u.designation, u.department, u.team_id, u.access_level, u.is_sales
      FROM users u
     WHERE u.deleted_at IS NULL AND u.active = TRUE
       AND (lower(trim(COALESCE(u.department,''))) = $1 OR u.is_sales = TRUE)
     ORDER BY u.access_level, u.name
  `, [SALES_DEPT]);

  if (isGlobalAdmin(req) || norm(req.role?.name) === "ceo" || norm(req.role?.name).includes("director")
      || Number(req.accessLevel) <= 2) return rows.filter((u) => Number(u.id) !== Number(req.user.id));

  // Sales Manager can set targets only for subordinate sales staff.
  return rows.filter((u) =>
    Number(u.id) !== Number(req.user.id) &&
    Number(u.access_level || 6) > Number(req.accessLevel || 3) &&
    norm(u.department) === SALES_DEPT
  );
}

async function assertManageableUser(req, userId) {
  if (!isSalesAssignmentAuthority(req)) throw new HttpError(403, "Only Sales Manager, CEO or Director can assign sales targets");
  const user = await db.one("SELECT * FROM users WHERE id=$1 AND deleted_at IS NULL AND active=TRUE", [Number(userId)]);
  if (!user || !isSalesUser(user)) throw new HttpError(422, "Target can be assigned only to an active sales employee");

  const allowed = await eligibleUsers(req);
  if (!allowed.some((u) => Number(u.id) === Number(user.id)))
    throw new HttpError(403, "This sales employee is outside your target-assignment authority");
  return user;
}

async function targetMetrics(t) {
  const period = [t.user_id, t.start_date, t.end_date];
  const sales = await db.one(`
    SELECT COALESCE(SUM(d.value),0)::float AS revenue, COUNT(*)::int AS won_deals
      FROM deals d
      JOIN deal_stages s ON s.id = d.stage_id
     WHERE d.assigned_user_id = $1
       AND s.kind = 'won'
       AND COALESCE(d.closed_at, d.created_at)::date BETWEEN $2 AND $3
  `, period);
  const assignments = await db.one(`
    SELECT COUNT(DISTINCT la.lead_id)::int AS assigned_leads
      FROM lead_assignments la
     WHERE la.user_id = $1
       AND la.created_at::date BETWEEN $2 AND $3
       AND la.assigned_by IS NOT NULL
  `, period);
  const converted = await db.one(`
    SELECT COUNT(*)::int AS converted_leads
      FROM leads l
     WHERE l.deleted_at IS NULL
       AND l.assigned_user_id = $1
       AND l.status = 'Won'
       AND l.updated_at::date BETWEEN $2 AND $3
  `, period);
  const revenue = money(sales?.revenue || 0);
  const wonDeals = Number(sales?.won_deals || 0);
  const assignedLeads = Number(assignments?.assigned_leads || 0);
  return {
    achieved_revenue: revenue,
    won_deals: wonDeals,
    assigned_leads: assignedLeads,
    converted_leads: Number(converted?.converted_leads || 0),
    revenue_percent: num(t.revenue_target) > 0 ? Math.min(999, Math.round(revenue / num(t.revenue_target) * 1000) / 10) : 0,
    deals_percent: num(t.deals_target) > 0 ? Math.min(999, Math.round(wonDeals / num(t.deals_target) * 1000) / 10) : 0,
    leads_percent: num(t.leads_target) > 0 ? Math.min(999, Math.round(assignedLeads / num(t.leads_target) * 1000) / 10) : 0,
  };
}

async function rowOut(row) {
  const [user, assigner, metrics] = await Promise.all([
    db.one("SELECT id,name,email,designation,department,team_id,access_level FROM users WHERE id=$1", [row.user_id]),
    row.assigned_by ? db.one("SELECT id,name FROM users WHERE id=$1", [row.assigned_by]) : null,
    targetMetrics(row),
  ]);
  return {
    ...row,
    revenue_target: num(row.revenue_target),
    deals_target: Number(row.deals_target || 0),
    leads_target: Number(row.leads_target || 0),
    start_date: String(row.start_date).slice(0, 10),
    end_date: String(row.end_date).slice(0, 10),
    user_name: user?.name || "Unknown",
    user_email: user?.email || "",
    designation: user?.designation || "",
    assigned_by_name: assigner?.name || "",
    ...metrics,
  };
}

router.get("/sales-targets", requireAuth, async (req, res, next) => {
  try {
    if (!canViewTargets(req)) throw new HttpError(403, "Sales targets are available only to the sales team and authorized management");
    const canManage = isSalesAssignmentAuthority(req);
    let rows;
    if (canManage) {
      const allowed = await eligibleUsers(req);
      const ids = allowed.map((u) => Number(u.id));
      if (isGlobalAdmin(req) || norm(req.role?.name) === "ceo" || norm(req.role?.name).includes("director") || Number(req.accessLevel) <= 2) {
        rows = await db.all(`
          SELECT st.* FROM sales_targets st
          JOIN users u ON u.id=st.user_id
          WHERE u.deleted_at IS NULL AND (lower(trim(COALESCE(u.department,'')))=$1 OR u.is_sales=TRUE)
          ORDER BY st.start_date DESC, u.name
        `, [SALES_DEPT]);
      } else {
        rows = ids.length
          ? await db.all("SELECT * FROM sales_targets WHERE user_id = ANY($1::int[]) ORDER BY start_date DESC, id DESC", [ids])
          : [];
      }
    } else {
      rows = await db.all("SELECT * FROM sales_targets WHERE user_id=$1 ORDER BY start_date DESC, id DESC", [req.user.id]);
    }
    const items = [];
    for (const row of rows) items.push(await rowOut(row));
    res.json({
      items,
      can_manage: canManage,
      scope: canManage ? "managed" : "self",
      eligible_users: canManage ? await eligibleUsers(req) : [],
      current_user_id: req.user.id,
    });
  } catch (e) { next(e); }
});

router.post("/sales-targets", requireAuth, async (req, res, next) => {
  try {
    const b = req.body || {};
    const user = await assertManageableUser(req, b.user_id);
    const start = String(b.start_date || "");
    const end = String(b.end_date || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end))
      throw new HttpError(422, "start_date and end_date are required");
    if (end < start) throw new HttpError(422, "end_date must be on or after start_date");
    const revenue = Math.max(0, num(b.revenue_target));
    const deals = Math.max(0, Math.floor(num(b.deals_target)));
    const leads = Math.max(0, Math.floor(num(b.leads_target)));
    const r = await db.query(`
      INSERT INTO sales_targets
        (user_id,start_date,end_date,revenue_target,deals_target,leads_target,notes,assigned_by,active)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,TRUE)
      ON CONFLICT (user_id,start_date,end_date) DO UPDATE SET
        revenue_target=EXCLUDED.revenue_target,
        deals_target=EXCLUDED.deals_target,
        leads_target=EXCLUDED.leads_target,
        notes=EXCLUDED.notes,
        assigned_by=EXCLUDED.assigned_by,
        active=TRUE,
        updated_at=now()
      RETURNING *
    `, [user.id, start, end, revenue, deals, leads, String(b.notes || ""), req.user.id]);
    await db.query(
      "INSERT INTO notifications (user_id,title,body,link,kind) VALUES ($1,$2,$3,'/targets','system')",
      [user.id, "Sales target assigned", `${req.user.name} assigned your sales target for ${start} to ${end}.`],
    );
    await db.query(
      "INSERT INTO audit_logs (user_id,user_name,action,target,detail) VALUES ($1,$2,$3,$4,$5)",
      [req.user.id, req.user.name, "Sales Target Assigned", `user:${user.id}`,
       `Revenue ₹${revenue}; deals ${deals}; leads ${leads}; ${start} to ${end}`],
    );
    res.status(201).json(await rowOut(r.rows[0]));
  } catch (e) { next(e); }
});

router.patch("/sales-targets/:id", requireAuth, async (req, res, next) => {
  try {
    if (!isSalesAssignmentAuthority(req)) throw new HttpError(403, "Only Sales Manager, CEO or Director can edit sales targets");
    const target = await db.one("SELECT * FROM sales_targets WHERE id=$1", [Number(req.params.id)]);
    if (!target) throw new HttpError(404, "Sales target not found");
    await assertManageableUser(req, target.user_id);
    const b = req.body || {};
    const allowed = ["start_date","end_date","revenue_target","deals_target","leads_target","notes","active"];
    const patch = Object.entries(b).filter(([k,v]) => allowed.includes(k) && v !== undefined);
    if (!patch.length) return res.json(await rowOut(target));
    const clean = patch.map(([k,v]) => {
      if (k === "revenue_target") return [k, Math.max(0, num(v))];
      if (k === "deals_target" || k === "leads_target") return [k, Math.max(0, Math.floor(num(v)))];
      return [k, v];
    });
    const nextStart = String((b.start_date ?? target.start_date)).slice(0,10);
    const nextEnd = String((b.end_date ?? target.end_date)).slice(0,10);
    if (nextEnd < nextStart) throw new HttpError(422, "end_date must be on or after start_date");
    const sets = clean.map(([k], i) => `${k}=$${i+1}`).concat("updated_at=now()").join(",");
    await db.query(`UPDATE sales_targets SET ${sets} WHERE id=$${clean.length+1}`, [...clean.map(([,v]) => v), target.id]);
    await db.query(
      "INSERT INTO audit_logs (user_id,user_name,action,target,detail) VALUES ($1,$2,'Sales Target Updated',$3,$4)",
      [req.user.id, req.user.name, `target:${target.id}`, target.user_id],
    );
    res.json(await rowOut(await db.one("SELECT * FROM sales_targets WHERE id=$1", [target.id])));
  } catch (e) { next(e); }
});

router.delete("/sales-targets/:id", requireAuth, async (req, res, next) => {
  try {
    if (!isSalesAssignmentAuthority(req)) throw new HttpError(403, "Only Sales Manager, CEO or Director can remove sales targets");
    const target = await db.one("SELECT * FROM sales_targets WHERE id=$1", [Number(req.params.id)]);
    if (!target) throw new HttpError(404, "Sales target not found");
    await assertManageableUser(req, target.user_id);
    await db.query("UPDATE sales_targets SET active=FALSE, updated_at=now() WHERE id=$1", [target.id]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
