/**
 * One-time cleanup of the original seeded/demo workspace.
 *
 * The cleanup is deliberately fingerprint-based so real records created later
 * are preserved. It also detaches real records from seeded users/teams before
 * removing those seeded identities.
 */
const { db, initSchema } = require("./db");

const OWNER_EMAIL = "admin@crm.local";
const DEMO_EMAILS = [
  "kavya@itctcrm.in",
  "rohit@itctcrm.in",
  "rahul@itctcrm.in",
  "priya@itctcrm.in",
  "amit@itctcrm.in",
  "sneha@itctcrm.in",
  "vikram@itctcrm.in",
  "neha@itctcrm.in",
];
const DEMO_TEAMS = ["Pune Sales Team", "West Sales Team", "Enterprise Team"];
const DEMO_COMPANIES = [
  "Sharma Textiles", "Deshpande Engineering", "Krishna Interiors", "Veda Wellness Clinics",
  "Sunrise EduTech", "BlueLotus Realty", "Zenith Fitness Club", "Coastal Marine Logistics",
  "SecureNet Systems", "Patel Ceramics",
];
const DEMO_SKUS = ["WD-01", "CRM-01", "DM-01", "SEO-01", "MA-01", "SD-01", "AM-01", "EC-01", "CS-01"];
const DEMO_RULES = [
  "Hot leads — priority + manager alert",
  "First touch after assignment",
  "Quotation sent → 2-day follow-up",
  "Overdue invoice → notify",
];
const DEMO_TASK_TITLES = [
  "Send proposal deck", "Prepare demo environment", "Collect GST details",
  "Draft quotation", "Verify payment receipt", "Renewal discussion prep",
];

const ids = (rows) => rows.map((r) => Number(r.id)).filter(Number.isFinite);
const any = (a) => a.length > 0;

async function cleanupDemoData() {
  await initSchema();
  return db.tx(async (c) => {
    const done = await c.query("SELECT 1 FROM crm_settings WHERE key = 'demo_cleanup_v1'");
    if (done.rowCount) return { skipped: true, reason: "already cleaned" };

    const owner = (await c.query("SELECT id FROM users WHERE lower(email) = $1 AND deleted_at IS NULL", [OWNER_EMAIL])).rows[0];
    if (!owner) throw new Error("Refusing demo cleanup: Super Admin owner account is missing");
    const ownerId = Number(owner.id);

    const demoUsers = ids((await c.query("SELECT id FROM users WHERE lower(email) = ANY($1::text[])", [DEMO_EMAILS])).rows);
    const demoTeams = ids((await c.query("SELECT id FROM teams WHERE name = ANY($1::text[])", [DEMO_TEAMS])).rows);
    const demoLeads = ids((await c.query("SELECT id FROM leads WHERE ai_reason = 'Rule-scored from seeded demo data.'", [])).rows);
    const demoCustomers = ids((await c.query("SELECT id FROM customers WHERE customer_code LIKE 'CU-SEED-%'", [])).rows);
    const demoCompanies = ids((await c.query("SELECT id FROM companies WHERE name = ANY($1::text[])", [DEMO_COMPANIES])).rows);
    const demoQuotes = ids((await c.query("SELECT id FROM quotations WHERE quotation_number LIKE 'QT-SEED-%'", [])).rows);
    const demoInvoices = ids((await c.query("SELECT id FROM invoices WHERE invoice_number LIKE 'INV-SEED-%'", [])).rows);
    const demoRules = ids((await c.query("SELECT id FROM automation_rules WHERE name = ANY($1::text[])", [DEMO_RULES])).rows);

    const removed = {};
    const del = async (key, sql, params = []) => {
      const r = await c.query(sql, params);
      removed[key] = r.rowCount || 0;
    };

    // Preserve real records that happen to point at an original demo employee/team.
    if (any(demoUsers)) {
      await c.query("UPDATE users SET reporting_manager_id = NULL WHERE reporting_manager_id = ANY($1::int[])", [demoUsers]);
      await c.query("UPDATE leads SET assigned_user_id = NULL WHERE assigned_user_id = ANY($1::int[]) AND NOT (id = ANY($2::int[]))", [demoUsers, demoLeads]);
      await c.query("UPDATE leads SET created_by = $1 WHERE created_by = ANY($2::int[]) AND NOT (id = ANY($3::int[]))", [ownerId, demoUsers, demoLeads]);
      await c.query("UPDATE customers SET account_manager_id = NULL WHERE account_manager_id = ANY($1::int[]) AND NOT (id = ANY($2::int[]))", [demoUsers, demoCustomers]);
      await c.query("UPDATE customers SET created_by = $1 WHERE created_by = ANY($2::int[]) AND NOT (id = ANY($3::int[]))", [ownerId, demoUsers, demoCustomers]);
      await c.query("UPDATE companies SET account_manager_id = NULL WHERE account_manager_id = ANY($1::int[]) AND NOT (id = ANY($2::int[]))", [demoUsers, demoCompanies]);
      await c.query("UPDATE deals SET assigned_user_id = NULL WHERE assigned_user_id = ANY($1::int[])", [demoUsers]);
      await c.query("UPDATE followups SET employee_id = NULL WHERE employee_id = ANY($1::int[]) AND NOT (lead_id = ANY($2::int[]) OR customer_id = ANY($3::int[]))", [demoUsers, demoLeads, demoCustomers]);
      await c.query("UPDATE tasks SET assigned_to_id = NULL WHERE assigned_to_id = ANY($1::int[]) AND title <> ALL($2::text[])", [demoUsers, DEMO_TASK_TITLES]);
      await c.query("UPDATE tasks SET created_by_id = $1 WHERE created_by_id = ANY($2::int[]) AND title <> ALL($3::text[])", [ownerId, demoUsers, DEMO_TASK_TITLES]);
      await c.query("UPDATE calls SET employee_id = NULL WHERE employee_id = ANY($1::int[]) AND NOT (lead_id = ANY($2::int[]) OR customer_id = ANY($3::int[]))", [demoUsers, demoLeads, demoCustomers]);
      await c.query("UPDATE notes SET author_id = NULL WHERE author_id = ANY($1::int[])", [demoUsers]);
      await c.query("UPDATE quotations SET created_by = $1 WHERE created_by = ANY($2::int[]) AND NOT (id = ANY($3::int[]))", [ownerId, demoUsers, demoQuotes]);
      await c.query("UPDATE invoices SET created_by = $1 WHERE created_by = ANY($2::int[]) AND NOT (id = ANY($3::int[]))", [ownerId, demoUsers, demoInvoices]);
      await c.query("UPDATE payments SET recorded_by = $1 WHERE recorded_by = ANY($2::int[]) AND payment_number NOT LIKE 'PAY-SEED-%'", [ownerId, demoUsers]);
      await c.query("UPDATE expenses SET employee_id = NULL WHERE employee_id = ANY($1::int[])", [demoUsers]);
      await c.query("UPDATE activities SET actor_id = NULL WHERE actor_id = ANY($1::int[])", [demoUsers]);
      await c.query("UPDATE notifications SET user_id = NULL WHERE user_id = ANY($1::int[])", [demoUsers]);
      await c.query("UPDATE attachments SET uploaded_by = NULL WHERE uploaded_by = ANY($1::int[])", [demoUsers]);
      await c.query("UPDATE discovery_jobs SET created_by = $1 WHERE created_by = ANY($2::int[])", [ownerId, demoUsers]);
    }
    if (any(demoTeams)) {
      await c.query("UPDATE users SET team_id = NULL WHERE team_id = ANY($1::int[])", [demoTeams]);
      await c.query("UPDATE leads SET assigned_team_id = NULL WHERE assigned_team_id = ANY($1::int[]) AND NOT (id = ANY($2::int[]))", [demoTeams, demoLeads]);
    }

    // Delete seeded business records in FK-safe order.
    await del("payments", "DELETE FROM payments WHERE payment_number LIKE 'PAY-SEED-%'");
    await del("invoices", "DELETE FROM invoices WHERE invoice_number LIKE 'INV-SEED-%'");
    await del("quotations", "DELETE FROM quotations WHERE quotation_number LIKE 'QT-SEED-%'");

    if (any(demoCustomers) || any(demoCompanies) || any(demoLeads)) {
      await del("deals", "DELETE FROM deals WHERE customer_id = ANY($1::int[]) OR company_id = ANY($2::int[]) OR lead_id = ANY($3::int[])", [demoCustomers, demoCompanies, demoLeads]);
      await del("followups", "DELETE FROM followups WHERE lead_id = ANY($1::int[]) OR customer_id = ANY($2::int[])", [demoLeads, demoCustomers]);
      await del("meetings", "DELETE FROM meetings WHERE meeting_link = 'https://meet.google.com/itct-demo' OR lead_id = ANY($1::int[]) OR customer_id = ANY($2::int[])", [demoLeads, demoCustomers]);
      await del("calls", "DELETE FROM calls WHERE lead_id = ANY($1::int[]) OR customer_id = ANY($2::int[])", [demoLeads, demoCustomers]);
      await del("tasks_linked", "DELETE FROM tasks WHERE lead_id = ANY($1::int[]) OR customer_id = ANY($2::int[])", [demoLeads, demoCustomers]);
    }
    if (any(demoUsers)) {
      await del("tasks_seed", "DELETE FROM tasks WHERE (assigned_to_id = ANY($1::int[]) OR created_by_id = ANY($1::int[])) AND title = ANY($2::text[])", [demoUsers, DEMO_TASK_TITLES]);
    }

    if (any(demoCustomers)) await del("customers", "DELETE FROM customers WHERE id = ANY($1::int[])", [demoCustomers]);
    if (any(demoCompanies)) {
      await del("contacts", "DELETE FROM contacts WHERE company_id = ANY($1::int[])", [demoCompanies]);
      await del("companies", "DELETE FROM companies WHERE id = ANY($1::int[])", [demoCompanies]);
    }
    if (any(demoLeads)) {
      await del("lead_scores", "DELETE FROM lead_scores WHERE lead_id = ANY($1::int[])", [demoLeads]);
      await del("lead_assignments", "DELETE FROM lead_assignments WHERE lead_id = ANY($1::int[])", [demoLeads]);
      await del("leads", "DELETE FROM leads WHERE id = ANY($1::int[])", [demoLeads]);
    }

    await del("products", "DELETE FROM products WHERE sku = ANY($1::text[])", [DEMO_SKUS]);
    if (any(demoRules)) {
      await del("automation_executions", "DELETE FROM automation_executions WHERE rule_id = ANY($1::int[])", [demoRules]);
      await del("automation_rules", "DELETE FROM automation_rules WHERE id = ANY($1::int[])", [demoRules]);
    }
    await del("templates", `DELETE FROM message_templates WHERE (channel, name) IN (
      ('whatsapp','Introduction'),('whatsapp','Follow-up'),('whatsapp','Payment Reminder'),
      ('email','Introduction'),('email','Invoice'))`);
    await del("welcome_notification", "DELETE FROM notifications WHERE title = 'Welcome to ITCT CRM' AND body LIKE 'Seed data loaded%'");

    // Remove the seeded employee identities, but keep a working owner login and
    // strip the fake personal profile from that owner account.
    if (any(demoUsers)) {
      await del("refresh_tokens", "DELETE FROM refresh_tokens WHERE user_id = ANY($1::int[])", [demoUsers]);
      await del("users", "DELETE FROM users WHERE id = ANY($1::int[])", [demoUsers]);
    }
    if (any(demoTeams)) await del("teams", "DELETE FROM teams WHERE id = ANY($1::int[])", [demoTeams]);
    await c.query(`UPDATE users SET name = 'Super Admin', phone = '', department = 'Administration',
      designation = 'Super Admin', team_id = NULL, reporting_manager_id = NULL, joining_date = NULL,
      is_sales = FALSE WHERE id = $1`, [ownerId]);

    // Remove stale demo-user references from assignment settings without touching
    // the user's chosen strategy or thresholds.
    const a = (await c.query("SELECT value FROM crm_settings WHERE key = 'assignment'")).rows[0]?.value;
    if (a && typeof a === "object") {
      const bad = new Set(demoUsers.map(String));
      if (a.high_value_user_id != null && bad.has(String(a.high_value_user_id))) a.high_value_user_id = "";
      for (const k of ["category_map", "location_map"]) {
        if (a[k] && typeof a[k] === "object") {
          for (const [name, value] of Object.entries(a[k])) if (bad.has(String(value))) delete a[k][name];
        }
      }
      await c.query("UPDATE crm_settings SET value = $1 WHERE key = 'assignment'", [JSON.stringify(a)]);
    }

    await c.query("INSERT INTO crm_settings (key, value) VALUES ('demo_cleanup_v1', $1::jsonb)", [JSON.stringify({ completed_at: new Date().toISOString(), removed })]);
    return { skipped: false, removed };
  });
}

if (require.main === module) {
  cleanupDemoData()
    .then((r) => { console.log("[cleanup-demo]", JSON.stringify(r)); return db.end(); })
    .then(() => process.exit(0))
    .catch(async (e) => { console.error("[cleanup-demo] FAILED:", e.message); try { await db.end(); } catch {} process.exit(1); });
}

module.exports = { cleanupDemoData };
