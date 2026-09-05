/**
 * Permission-scoped dashboard endpoints.
 *
 * This router is mounted before the legacy analytics routes so employee
 * dashboards never expose company-wide data that their role cannot view.
 */
const express = require("express");
const { db } = require("../db");
const { money } = require("../core");
const { requireAuth, requirePerm, isWide, rolePerms } = require("../security");

const router = express.Router();
const num = (v) => (v === null || v === undefined ? v : Number(v));
const count = async (sql, params = []) => (await db.one(sql, params))?.n || 0;

const can = (req, module, perm = "view") => rolePerms(req.role.name, req.role.perms, module, perm);

router.get("/dashboard", requirePerm("dashboard", "view"), async (req, res, next) => {
  try {
    const wide = isWide(req.role);
    const uid = req.user.id;
    const range = req.query.range || "month";
    const now = new Date();
    const start = {
      today: new Date(now.toDateString()),
      week: new Date(Date.now() - 7 * 86400_000),
      month: new Date(now.getFullYear(), now.getMonth(), 1),
      quarter: new Date(Date.now() - 90 * 86400_000),
      year: new Date(now.getFullYear(), 0, 1),
    }[range] || new Date(now.getFullYear(), now.getMonth(), 1);

    const leads = await db.all(
      `SELECT * FROM leads WHERE deleted_at IS NULL ${wide ? "" : "AND assigned_user_id = $1"}`,
      wide ? [] : [uid],
    );
    const stages = await db.all('SELECT * FROM deal_stages ORDER BY "order"');
    const deals = await db.all(
      `SELECT * FROM deals ${wide ? "" : "WHERE assigned_user_id = $1"}`,
      wide ? [] : [uid],
    );
    const kindOf = (id) => stages.find((s) => s.id === id)?.kind || "open";
    const open = deals.filter((d) => kindOf(d.stage_id) === "open");
    const won = deals.filter((d) => kindOf(d.stage_id) === "won");
    const lost = deals.filter((d) => kindOf(d.stage_id) === "lost");

    let revenue = 0;
    if (can(req, "payments")) {
      const row = wide
        ? await db.one("SELECT COALESCE(SUM(amount),0)::float AS v FROM payments WHERE payment_date >= $1", [start])
        : await db.one(`SELECT COALESCE(SUM(p.amount),0)::float AS v
                        FROM payments p JOIN invoices i ON i.id = p.invoice_id
                        WHERE p.payment_date >= $1 AND i.created_by = $2`, [start, uid]);
      revenue = row?.v || 0;
    }

    let outstanding = 0;
    if (can(req, "invoices")) {
      const row = wide
        ? await db.one("SELECT COALESCE(SUM(balance_due),0)::float AS v FROM invoices")
        : await db.one("SELECT COALESCE(SUM(balance_due),0)::float AS v FROM invoices WHERE created_by = $1", [uid]);
      outstanding = row?.v || 0;
    }

    let expenses = 0;
    if (can(req, "expenses")) {
      const row = wide
        ? await db.one("SELECT COALESCE(SUM(amount),0)::float AS v FROM expenses WHERE date >= $1", [start])
        : await db.one("SELECT COALESCE(SUM(amount),0)::float AS v FROM expenses WHERE date >= $1 AND employee_id = $2", [start, uid]);
      expenses = row?.v || 0;
    }

    const today = now.toISOString().slice(0, 10);
    const converted = leads.filter((l) => l.status === "Won").length;
    const byMonth = [];
    for (let back = 5; back >= 0; back--) {
      const d0 = new Date(now.getFullYear(), now.getMonth() - back, 1);
      const d1 = new Date(now.getFullYear(), now.getMonth() - back + 1, 1);
      byMonth.push({
        month: d0.toLocaleString("en", { month: "short" }),
        leads: leads.filter((l) => new Date(l.created_at) >= d0 && new Date(l.created_at) < d1).length,
      });
    }

    const totalCustomers = wide
      ? await count("SELECT COUNT(*)::int AS n FROM customers WHERE deleted_at IS NULL")
      : await count("SELECT COUNT(*)::int AS n FROM customers WHERE deleted_at IS NULL AND account_manager_id = $1", [uid]);
    const tasksDue = wide
      ? await count("SELECT COUNT(*)::int AS n FROM tasks WHERE status IN ('Pending','In Progress')")
      : await count("SELECT COUNT(*)::int AS n FROM tasks WHERE status IN ('Pending','In Progress') AND assigned_to_id = $1", [uid]);
    const overdueTasks = wide
      ? await count("SELECT COUNT(*)::int AS n FROM tasks WHERE status IN ('Pending','In Progress') AND due_date < $1", [today])
      : await count("SELECT COUNT(*)::int AS n FROM tasks WHERE status IN ('Pending','In Progress') AND due_date < $1 AND assigned_to_id = $2", [today, uid]);
    const followupsToday = wide
      ? await count("SELECT COUNT(*)::int AS n FROM followups WHERE date = $1 AND status = 'Scheduled'", [today])
      : await count("SELECT COUNT(*)::int AS n FROM followups WHERE date = $1 AND status = 'Scheduled' AND employee_id = $2", [today, uid]);
    const overdueFollowups = wide
      ? await count("SELECT COUNT(*)::int AS n FROM followups WHERE status IN ('Scheduled','Missed') AND date < $1", [today])
      : await count("SELECT COUNT(*)::int AS n FROM followups WHERE status IN ('Scheduled','Missed') AND date < $1 AND employee_id = $2", [today, uid]);
    const meetingsToday = wide
      ? await count("SELECT COUNT(*)::int AS n FROM meetings WHERE date = $1", [today])
      : await count("SELECT COUNT(*)::int AS n FROM meetings WHERE date = $1 AND participants @> $2::jsonb", [today, JSON.stringify([uid])]);

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
      monthly_revenue: money(revenue),
      outstanding: money(outstanding),
      expenses: money(expenses),
      profit_estimate: money(revenue - expenses),
      tasks_due: tasksDue,
      overdue_tasks: overdueTasks,
      followups_today: followupsToday,
      overdue_followups: overdueFollowups,
      meetings_today: meetingsToday,
      conversion_rate: leads.length ? Math.round(converted / leads.length * 1000) / 10 : 0,
      win_rate: (won.length + lost.length) ? Math.round(won.length / (won.length + lost.length) * 1000) / 10 : 0,
      avg_deal_size: won.length ? money(won.reduce((a, d) => a + Number(d.value), 0) / won.length) : 0,
      pipeline_by_stage: stages.filter((s) => s.kind === "open").map((s) => ({
        stage: s.name,
        value: money(open.filter((d) => d.stage_id === s.id).reduce((a, d) => a + Number(d.value), 0)),
        count: open.filter((d) => d.stage_id === s.id).length,
      })),
      leads_by_month: byMonth,
    });
  } catch (e) { next(e); }
});

router.get("/dashboard/hot-leads", requirePerm("dashboard", "view"), async (req, res, next) => {
  try {
    const wide = isWide(req.role);
    const rows = await db.all(
      `SELECT * FROM leads WHERE deleted_at IS NULL AND temperature = 'Hot' AND status NOT IN ('Won','Lost')
       ${wide ? "" : "AND assigned_user_id = $1"} ORDER BY score DESC NULLS LAST LIMIT 6`,
      wide ? [] : [req.user.id],
    );
    res.json(rows.map((l) => ({
      id: l.id, business_name: l.business_name, city: l.city, industry: l.industry,
      score: l.score, estimated_value: num(l.estimated_value), recommended_action: l.recommended_action,
    })));
  } catch (e) { next(e); }
});

router.get("/dashboard/agenda", requireAuth, async (req, res, next) => {
  try {
    const wide = isWide(req.role);
    const today = new Date().toISOString().slice(0, 10);
    const fus = await db.all(
      `SELECT * FROM followups WHERE date = $1 AND status = 'Scheduled' ${wide ? "" : "AND employee_id = $2"} ORDER BY time`,
      wide ? [today] : [today, req.user.id],
    );
    const followups = [];
    for (const f of fus) {
      const entity = f.lead_id
        ? await db.one("SELECT business_name AS name FROM leads WHERE id = $1", [f.lead_id])
        : await db.one("SELECT name FROM customers WHERE id = $1", [f.customer_id]);
      const employee = await db.one("SELECT name FROM users WHERE id = $1", [f.employee_id]);
      followups.push({
        id: f.id, type: f.type, time: f.time, entity_type: f.lead_id ? "lead" : "customer",
        entity_id: f.lead_id || f.customer_id, name: entity?.name || "—", employee: employee?.name || "",
      });
    }
    const meets = await db.all(
      `SELECT * FROM meetings WHERE date = $1 ${wide ? "" : "AND participants @> $2::jsonb"} ORDER BY start_time`,
      wide ? [today] : [today, JSON.stringify([req.user.id])],
    );
    res.json({
      followups,
      meetings: meets.map((m) => ({ id: m.id, title: m.title, start: m.start_time, end: m.end_time, location: m.location })),
    });
  } catch (e) { next(e); }
});

router.get("/dashboard/activity", requireAuth, async (req, res, next) => {
  try {
    const wide = isWide(req.role);
    const rows = await db.all(
      `SELECT * FROM activities ${wide ? "" : "WHERE actor_id = $1"} ORDER BY created_at DESC LIMIT 14`,
      wide ? [] : [req.user.id],
    );
    const out = [];
    for (const a of rows) {
      const u = a.actor_id ? await db.one("SELECT name FROM users WHERE id = $1", [a.actor_id]) : null;
      out.push({ id: a.id, user: u?.name || "System", action: a.action, detail: a.meta?.detail || "", at: a.created_at });
    }
    res.json(out);
  } catch (e) { next(e); }
});

module.exports = router;
