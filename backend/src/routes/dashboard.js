/**
 * Workforce OS scoped dashboard endpoints.
 * L1/L2: global; L3: department; L4: team; L5/L6: self.
 */
const express = require("express");
const { db } = require("../db");
const { money } = require("../core");
const { requireAuth, requirePerm, rolePerms } = require("../security");
const { scopedUserIds } = require("../workforce-scope");

const router = express.Router();
const num = (v) => (v === null || v === undefined ? v : Number(v));
const count = async (sql, params = []) => (await db.one(sql, params))?.n || 0;
const can = (req, module, perm = "view") => rolePerms(req.role.name, req.role.perms, module, perm);
const scopeIds = async (req) => scopedUserIds(req);
const ownerWhere = (ids, col, offset = 0) => ids === null ? { sql: "", params: [] } : { sql: `${col} = ANY($${offset + 1}::int[])`, params: [ids] };

router.get("/dashboard", requirePerm("dashboard", "view"), async (req, res, next) => {
  try {
    const ids = await scopeIds(req);
    const range = req.query.range || "month";
    const now = new Date();
    const start = {
      today: new Date(now.toDateString()),
      week: new Date(Date.now() - 7 * 86400_000),
      month: new Date(now.getFullYear(), now.getMonth(), 1),
      quarter: new Date(Date.now() - 90 * 86400_000),
      year: new Date(now.getFullYear(), 0, 1),
    }[range] || new Date(now.getFullYear(), now.getMonth(), 1);

    const leads = ids === null
      ? await db.all("SELECT * FROM leads WHERE deleted_at IS NULL")
      : await db.all("SELECT * FROM leads WHERE deleted_at IS NULL AND assigned_user_id = ANY($1::int[])", [ids]);
    const stages = await db.all('SELECT * FROM deal_stages ORDER BY "order"');
    const deals = ids === null
      ? await db.all("SELECT * FROM deals")
      : await db.all("SELECT * FROM deals WHERE assigned_user_id = ANY($1::int[])", [ids]);
    const kindOf = (id) => stages.find((s) => s.id === id)?.kind || "open";
    const open = deals.filter((d) => kindOf(d.stage_id) === "open");
    const won = deals.filter((d) => kindOf(d.stage_id) === "won");
    const lost = deals.filter((d) => kindOf(d.stage_id) === "lost");

    let revenue = 0;
    if (can(req, "payments")) {
      const row = ids === null
        ? await db.one("SELECT COALESCE(SUM(amount),0)::float AS v FROM payments WHERE payment_date >= $1", [start])
        : await db.one(`SELECT COALESCE(SUM(p.amount),0)::float AS v
                        FROM payments p JOIN invoices i ON i.id = p.invoice_id
                        WHERE p.payment_date >= $1 AND i.created_by = ANY($2::int[])`, [start, ids]);
      revenue = row?.v || 0;
    }

    let outstanding = 0;
    if (can(req, "invoices")) {
      const row = ids === null
        ? await db.one("SELECT COALESCE(SUM(balance_due),0)::float AS v FROM invoices")
        : await db.one("SELECT COALESCE(SUM(balance_due),0)::float AS v FROM invoices WHERE created_by = ANY($1::int[])", [ids]);
      outstanding = row?.v || 0;
    }

    let expenses = 0;
    if (can(req, "expenses")) {
      const row = ids === null
        ? await db.one("SELECT COALESCE(SUM(amount),0)::float AS v FROM expenses WHERE date >= $1", [start])
        : await db.one("SELECT COALESCE(SUM(amount),0)::float AS v FROM expenses WHERE date >= $1 AND employee_id = ANY($2::int[])", [start, ids]);
      expenses = row?.v || 0;
    }

    const today = now.toISOString().slice(0, 10);
    const converted = leads.filter((l) => l.status === "Won").length;
    const byMonth = [];
    for (let back = 5; back >= 0; back--) {
      const d0 = new Date(now.getFullYear(), now.getMonth() - back, 1);
      const d1 = new Date(now.getFullYear(), now.getMonth() - back + 1, 1);
      byMonth.push({ month: d0.toLocaleString("en", { month: "short" }), leads: leads.filter((l) => new Date(l.created_at) >= d0 && new Date(l.created_at) < d1).length });
    }

    const totalCustomers = ids === null
      ? await count("SELECT COUNT(*)::int AS n FROM customers WHERE deleted_at IS NULL")
      : await count("SELECT COUNT(*)::int AS n FROM customers WHERE deleted_at IS NULL AND account_manager_id = ANY($1::int[])", [ids]);
    const tasksDue = ids === null
      ? await count("SELECT COUNT(*)::int AS n FROM tasks WHERE status IN ('Pending','In Progress')")
      : await count("SELECT COUNT(*)::int AS n FROM tasks WHERE status IN ('Pending','In Progress') AND assigned_to_id = ANY($1::int[])", [ids]);
    const overdueTasks = ids === null
      ? await count("SELECT COUNT(*)::int AS n FROM tasks WHERE status IN ('Pending','In Progress') AND due_date < $1", [today])
      : await count("SELECT COUNT(*)::int AS n FROM tasks WHERE status IN ('Pending','In Progress') AND due_date < $1 AND assigned_to_id = ANY($2::int[])", [today, ids]);
    const followupsToday = ids === null
      ? await count("SELECT COUNT(*)::int AS n FROM followups WHERE date = $1 AND status = 'Scheduled'", [today])
      : await count("SELECT COUNT(*)::int AS n FROM followups WHERE date = $1 AND status = 'Scheduled' AND employee_id = ANY($2::int[])", [today, ids]);
    const overdueFollowups = ids === null
      ? await count("SELECT COUNT(*)::int AS n FROM followups WHERE status IN ('Scheduled','Missed') AND date < $1", [today])
      : await count("SELECT COUNT(*)::int AS n FROM followups WHERE status IN ('Scheduled','Missed') AND date < $1 AND employee_id = ANY($2::int[])", [today, ids]);
    const meetingsToday = ids === null
      ? await count("SELECT COUNT(*)::int AS n FROM meetings WHERE date = $1", [today])
      : await count(`SELECT COUNT(*)::int AS n FROM meetings WHERE date = $1 AND EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(COALESCE(participants,'[]'::jsonb)) p(v)
          WHERE p.v = ANY($2::text[]))`, [today, ids.map(String)]);

    res.json({
      total_leads: leads.length,
      new_leads: leads.filter((l) => l.status === "New").length,
      hot_leads: leads.filter((l) => l.temperature === "Hot" && !["Won", "Lost"].includes(l.status)).length,
      qualified_leads: leads.filter((l) => ["Qualified", "Proposal", "Negotiation"].includes(l.status)).length,
      converted_leads: converted,
      lost_leads: leads.filter((l) => l.status === "Lost").length,
      total_customers: totalCustomers,
      pipeline_value: money(open.reduce((a, d) => a + Number(d.value), 0)),
      won_revenue: money(won.reduce((a, d) => a + Number(d.value), 0)),
      monthly_revenue: money(revenue), outstanding: money(outstanding), expenses: money(expenses), profit_estimate: money(revenue - expenses),
      tasks_due: tasksDue, overdue_tasks: overdueTasks, followups_today: followupsToday, overdue_followups: overdueFollowups, meetings_today: meetingsToday,
      conversion_rate: leads.length ? Math.round(converted / leads.length * 1000) / 10 : 0,
      win_rate: (won.length + lost.length) ? Math.round(won.length / (won.length + lost.length) * 1000) / 10 : 0,
      avg_deal_size: won.length ? money(won.reduce((a, d) => a + Number(d.value), 0) / won.length) : 0,
      pipeline_by_stage: stages.filter((s) => s.kind === "open").map((s) => ({
        stage: s.name, value: money(open.filter((d) => d.stage_id === s.id).reduce((a, d) => a + Number(d.value), 0)), count: open.filter((d) => d.stage_id === s.id).length,
      })),
      leads_by_month: byMonth,
    });
  } catch (e) { next(e); }
});

router.get("/dashboard/hot-leads", requirePerm("dashboard", "view"), async (req, res, next) => {
  try {
    const ids = await scopeIds(req);
    const rows = ids === null
      ? await db.all("SELECT * FROM leads WHERE deleted_at IS NULL AND temperature='Hot' AND status NOT IN ('Won','Lost') ORDER BY score DESC NULLS LAST LIMIT 6")
      : await db.all("SELECT * FROM leads WHERE deleted_at IS NULL AND temperature='Hot' AND status NOT IN ('Won','Lost') AND assigned_user_id = ANY($1::int[]) ORDER BY score DESC NULLS LAST LIMIT 6", [ids]);
    res.json(rows.map((l) => ({ id: l.id, business_name: l.business_name, city: l.city, industry: l.industry, score: l.score, estimated_value: num(l.estimated_value), recommended_action: l.recommended_action })));
  } catch (e) { next(e); }
});

router.get("/dashboard/agenda", requireAuth, async (req, res, next) => {
  try {
    const ids = await scopeIds(req);
    const today = new Date().toISOString().slice(0, 10);
    const fus = ids === null
      ? await db.all("SELECT * FROM followups WHERE date=$1 AND status='Scheduled' ORDER BY time", [today])
      : await db.all("SELECT * FROM followups WHERE date=$1 AND status='Scheduled' AND employee_id = ANY($2::int[]) ORDER BY time", [today, ids]);
    const followups = [];
    for (const f of fus) {
      const entity = f.lead_id ? await db.one("SELECT business_name AS name FROM leads WHERE id=$1", [f.lead_id]) : await db.one("SELECT name FROM customers WHERE id=$1", [f.customer_id]);
      const employee = await db.one("SELECT name FROM users WHERE id=$1", [f.employee_id]);
      followups.push({ id: f.id, type: f.type, time: f.time, entity_type: f.lead_id ? "lead" : "customer", entity_id: f.lead_id || f.customer_id, name: entity?.name || "—", employee: employee?.name || "" });
    }
    const meets = ids === null
      ? await db.all("SELECT * FROM meetings WHERE date=$1 ORDER BY start_time", [today])
      : await db.all(`SELECT * FROM meetings WHERE date=$1 AND EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(COALESCE(participants,'[]'::jsonb)) p(v)
          WHERE p.v = ANY($2::text[])) ORDER BY start_time`, [today, ids.map(String)]);
    res.json({ followups, meetings: meets.map((m) => ({ id: m.id, title: m.title, start: m.start_time, end: m.end_time, location: m.location })) });
  } catch (e) { next(e); }
});

router.get("/dashboard/activity", requireAuth, async (req, res, next) => {
  try {
    const ids = await scopeIds(req);
    const rows = ids === null
      ? await db.all("SELECT * FROM activities ORDER BY created_at DESC LIMIT 14")
      : await db.all("SELECT * FROM activities WHERE actor_id = ANY($1::int[]) ORDER BY created_at DESC LIMIT 14", [ids]);
    const out = [];
    for (const a of rows) {
      const u = a.actor_id ? await db.one("SELECT name FROM users WHERE id=$1", [a.actor_id]) : null;
      out.push({ id: a.id, user: u?.name || "System", action: a.action, detail: a.meta?.detail || "", at: a.created_at });
    }
    res.json(out);
  } catch (e) { next(e); }
});

module.exports = router;
