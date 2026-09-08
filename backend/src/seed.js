/**
 * Production bootstrap after Workforce OS Step 3.
 * Creates only the technical L1/L2 identities plus the approved 56 L3-L6
 * Workforce roles. Legacy CRM roles are never recreated by the seed command.
 */
const { db, initSchema } = require("./db");
const { hashPassword } = require("./security");
const { ensureAuthSchema } = require("./auth-schema");
const { ensureAccessLevelSchema } = require("./access-levels");
const { ensureOrganizationSchema } = require("./organization-schema");
const { ensureWorkforceRoleSchema } = require("./workforce-role-schema");

async function main() {
  await initSchema();
  await ensureAuthSchema();

  for (const [name, description] of [
    ["Super Admin", "L1 global Workforce OS authority"],
    ["Admin", "L2 operational administration authority"],
  ]) {
    await db.query(
      `INSERT INTO roles (name, description, system, perms)
       VALUES ($1,$2,TRUE,NULL)
       ON CONFLICT (name) DO UPDATE SET description=EXCLUDED.description, system=TRUE`,
      [name, description],
    );
  }

  await ensureAccessLevelSchema();
  await ensureOrganizationSchema();
  await ensureWorkforceRoleSchema();

  const existingUsers = await db.one("SELECT COUNT(*)::int AS n FROM users WHERE deleted_at IS NULL");
  if (!existingUsers?.n) {
    const superRole = await db.one("SELECT id FROM roles WHERE name = 'Super Admin'");
    await db.query(
      `INSERT INTO users
         (name, email, phone, password_hash, department, designation, role_id,
          is_sales, active, color, access_level, must_change_password)
       VALUES ('Super Admin','admin@crm.local','',$1,'','Super Admin',$2,FALSE,TRUE,'#0F766E',1,TRUE)`,
      [hashPassword("Admin@123"), superRole.id],
    );
    console.log("[bootstrap] Super Admin created: admin@crm.local / Admin@123 — change this password immediately");
  } else {
    console.log(`[bootstrap] ${existingUsers.n} existing user(s); no sample users created`);
  }

  console.log("[bootstrap] Workforce OS roles ready: 2 global identities + 56 approved department roles; no demo business data created");
  await db.end();
}

main().then(() => process.exit(0)).catch(async (e) => {
  console.error("[bootstrap] FAILED:", e.message);
  try { await db.end(); } catch {}
  process.exit(1);
});
