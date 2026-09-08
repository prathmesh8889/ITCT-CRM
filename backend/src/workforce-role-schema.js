/** Step 3/4 database synchronization for the approved Workforce OS role catalog. */
const { db } = require("./db");
const { ensureOrganizationSchema } = require("./organization-schema");
const { WORKFORCE_ROLES } = require("./workforce-roles");
const { workforcePermissions } = require("./workforce-permissions");

let ready = null;

function ensureWorkforceRoleSchema() {
  if (!ready) {
    ready = (async () => {
      await ensureOrganizationSchema();
      await db.query(`
        ALTER TABLE roles ADD COLUMN IF NOT EXISTS department_key TEXT;
        ALTER TABLE roles ADD COLUMN IF NOT EXISTS access_level SMALLINT;
        ALTER TABLE roles ADD COLUMN IF NOT EXISTS primary_function TEXT DEFAULT '';
        ALTER TABLE roles ADD COLUMN IF NOT EXISTS workforce_role BOOLEAN NOT NULL DEFAULT FALSE;
        ALTER TABLE roles ADD COLUMN IF NOT EXISTS assignment_enabled BOOLEAN NOT NULL DEFAULT TRUE;
        DO $$
        BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_roles_access_level') THEN
            ALTER TABLE roles ADD CONSTRAINT ck_roles_access_level
              CHECK (access_level IS NULL OR access_level BETWEEN 1 AND 6);
          END IF;
        END $$;
        CREATE INDEX IF NOT EXISTS ix_roles_department_key ON roles(department_key);
        CREATE UNIQUE INDEX IF NOT EXISTS ux_workforce_role_department_level
          ON roles(department_key, access_level) WHERE workforce_role = TRUE;
      `);

      await db.tx(async (client) => {
        for (const role of WORKFORCE_ROLES) {
          const perms = workforcePermissions(role);
          await client.query(
            `INSERT INTO roles
               (name, description, system, perms, department_key, access_level,
                primary_function, workforce_role, assignment_enabled)
             VALUES ($1,$2,TRUE,$3,$4,$5,$6,TRUE,TRUE)
             ON CONFLICT (name) DO UPDATE SET
               description = EXCLUDED.description,
               system = TRUE,
               perms = EXCLUDED.perms,
               department_key = EXCLUDED.department_key,
               access_level = EXCLUDED.access_level,
               primary_function = EXCLUDED.primary_function,
               workforce_role = TRUE,
               assignment_enabled = TRUE`,
            [
              role.title,
              `L${role.level} · ${role.department} · ${role.primary_function}`,
              JSON.stringify(perms),
              role.department_key,
              role.level,
              role.primary_function,
            ],
          );
        }

        // L1/L2 are the only global identities. Their legacy `perms = null`
        // behavior remains intentional because security.js treats them as full access.
        await client.query(`
          UPDATE roles
             SET access_level = CASE WHEN lower(trim(name)) = 'super admin' THEN 1 ELSE 2 END,
                 department_key = NULL,
                 workforce_role = FALSE,
                 assignment_enabled = TRUE
           WHERE lower(trim(name)) IN ('super admin','admin')
        `);

        // Old/custom roles stay attached to historical users but cannot be newly
        // assigned. This prevents data loss while keeping the PDF catalog canonical.
        await client.query(`
          UPDATE roles
             SET assignment_enabled = FALSE
           WHERE workforce_role = FALSE
             AND lower(trim(name)) NOT IN ('super admin','admin')
        `);

        // Exact existing Workforce roles are safe to canonicalize: role title ->
        // one department + one level. No fuzzy mapping of legacy role titles occurs.
        await client.query(`
          UPDATE users u
             SET access_level = r.access_level,
                 department = d.name,
                 designation = r.name
            FROM roles r
            JOIN departments d ON d.system_key = r.department_key AND d.system = TRUE
           WHERE u.role_id = r.id
             AND u.deleted_at IS NULL
             AND r.workforce_role = TRUE
        `);
      });
    })().catch((e) => {
      ready = null;
      throw e;
    });
  }
  return ready;
}

module.exports = { ensureWorkforceRoleSchema };
