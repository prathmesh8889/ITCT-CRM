/**
 * Production bootstrap after Workforce OS Step 3.
 * Creates approved system roles and, only on an empty database, one bootstrap
 * Super Admin from environment variables. No production credential is stored
 * in source control.
 */
const { db, initSchema } = require("./db");
const { hashPassword, passwordPolicyError } = require("./security");
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
    const email = String(process.env.BOOTSTRAP_ADMIN_EMAIL || "").trim().toLowerCase();
    const password = String(process.env.BOOTSTRAP_ADMIN_PASSWORD || "");
    if (!/^\S+@\S+\.\S+$/.test(email))
      throw new Error("BOOTSTRAP_ADMIN_EMAIL is required and must be a valid email when creating the first user");
    const passwordError = passwordPolicyError(password);
    if (passwordError)
      throw new Error(`BOOTSTRAP_ADMIN_PASSWORD: ${passwordError}`);

    const superRole = await db.one("SELECT id FROM roles WHERE name = 'Super Admin'");
    await db.query(
      `INSERT INTO users
         (name, email, phone, password_hash, department, designation, role_id,
          is_sales, active, color, access_level, must_change_password)
       VALUES ('Super Admin',$1,'',$2,'','Super Admin',$3,FALSE,TRUE,'#0F766E',1,TRUE)`,
      [email, hashPassword(password), superRole.id],
    );
    console.log(`[bootstrap] Super Admin created for ${email}; password change required on first login`);
  } else {
    console.log(`[bootstrap] ${existingUsers.n} existing user(s); no bootstrap user created`);
  }

  console.log("[bootstrap] Workforce OS roles ready; no demo business data created");
  await db.end();
}

main().then(() => process.exit(0)).catch(async (e) => {
  console.error("[bootstrap] FAILED:", e.message);
  try { await db.end(); } catch {}
  process.exit(1);
});
