/**
 * Production bootstrap.
 * Creates only system roles and one Super Admin when the database is empty.
 * No demo leads, fake employees, companies, customers, deals or billing data.
 */
const { db, initSchema } = require("./db");
const { hashPassword } = require("./security");

const ROLES = {
  "Super Admin": { description: "Full control of every module", system: true, perms: null },
  "Admin": { description: "Manages CRM configuration and data", system: true, perms: null },
  "Sales Manager": { description: "Team oversight, assignment and reporting", system: true, perms: {
    dashboard: ["view"], leads: ["view", "create", "edit", "assign", "export"], discovery: ["view", "create", "edit", "delete"],
    customers: ["view", "create", "edit", "export"], companies: ["view", "create", "edit"], contacts: ["view", "create", "edit"],
    deals: ["view", "create", "edit", "assign", "export"], followups: ["view", "create", "edit"],
    tasks: ["view", "create", "edit", "assign"], meetings: ["view", "create", "edit"], calendar: ["view"],
    quotations: ["view", "create", "edit", "approve", "export"], invoices: ["view", "create", "edit", "export"],
    payments: ["view", "create"], expenses: ["view"], products: ["view"], employees: ["view"],
    reports: ["view", "export"], automation: ["view", "create", "edit"], ai: ["view", "create"], settings: ["view"], audit: ["view"] } },
  "Sales Executive": { description: "Works assigned leads and deals", system: true, perms: {
    dashboard: ["view"], leads: ["view", "create", "edit"], customers: ["view", "create"], companies: ["view"],
    contacts: ["view", "create"], deals: ["view", "create", "edit"], followups: ["view", "create", "edit"],
    tasks: ["view", "create", "edit"], meetings: ["view", "create"], calendar: ["view"],
    quotations: ["view", "create", "edit"], invoices: ["view"], payments: ["view"], reports: ["view"], ai: ["view", "create"] } },
  "Marketing Executive": { description: "Lead discovery and campaigns", system: true, perms: {
    dashboard: ["view"], leads: ["view", "create", "edit", "export"], discovery: ["view", "create", "edit", "delete"],
    customers: ["view"], reports: ["view"] } },
  "Accountant": { description: "Billing, payments and books", system: true, perms: {
    dashboard: ["view"], quotations: ["view", "create", "edit", "export"], invoices: ["view", "create", "edit", "export"],
    payments: ["view", "create", "edit", "export"], expenses: ["view", "create", "edit", "export"],
    customers: ["view"], products: ["view", "create", "edit"], reports: ["view", "export"] } },
  "Support": { description: "Read-only customer context", system: true, perms: {
    dashboard: ["view"], customers: ["view"], tasks: ["view", "create", "edit"] } },
  "Employee": { description: "Basic employee access", system: true, perms: {
    dashboard: ["view"], tasks: ["view", "create", "edit"] } },
};

async function main() {
  await initSchema();

  const roleIds = {};
  for (const [name, cfg] of Object.entries(ROLES)) {
    const r = await db.query(
      `INSERT INTO roles (name, description, system, perms)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (name) DO UPDATE SET description = EXCLUDED.description, system = EXCLUDED.system
       RETURNING id`,
      [name, cfg.description, cfg.system, cfg.perms === null ? null : JSON.stringify(cfg.perms)],
    );
    roleIds[name] = r.rows[0].id;
  }

  const existingUsers = await db.one("SELECT COUNT(*)::int AS n FROM users WHERE deleted_at IS NULL");
  if (!existingUsers?.n) {
    await db.query(
      `INSERT INTO users (name, email, phone, password_hash, department, designation, role_id, is_sales, active, color)
       VALUES ('Super Admin','admin@crm.local','',$1,'Administration','Super Admin',$2,FALSE,TRUE,'#0F766E')`,
      [hashPassword("Admin@123"), roleIds["Super Admin"]],
    );
    console.log("[bootstrap] Super Admin created: admin@crm.local / Admin@123 — change this password immediately");
  } else {
    console.log(`[bootstrap] ${existingUsers.n} existing user(s); no sample users created`);
  }

  console.log("[bootstrap] system roles ready; no demo business data created");
  await db.end();
}

main().then(() => process.exit(0)).catch(async (e) => {
  console.error("[bootstrap] FAILED:", e.message);
  try { await db.end(); } catch {}
  process.exit(1);
});
