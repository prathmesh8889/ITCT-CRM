/** Step 3 database migration/synchronization for the approved Workforce OS role catalog. */
const { db } = require("./db");
const { ensureOrganizationSchema } = require("./organization-schema");
const { WORKFORCE_ROLES } = require("./workforce-roles");

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
          await client.query(
            `INSERT INTO roles
               (name, description, system, perms, department_key, access_level,
                primary_function, workforce_role, assignment_enabled)
             VALUES ($1,$2,TRUE,$3,$4,$5,$6,TRUE,TRUE)
             ON CONFLICT (name) DO UPDATE SET
               description = EXCLUDED.description,
               system = TRUE,
               department_key = EXCLUDED.department_key,
               access_level = EXCLUDED.access_level,
               primary_function = EXCLUDED.primary_function,
               workforce_role = TRUE,
               assignment_enabled = TRUE`,
            [
              role.title,
              `L${role.level} · ${role.department} · ${role.primary_function}`,
              JSON.stringify({ dashboard: ["view"] }),
              role.department_key,
              role.level,
              role.primary_function,
            ],
          );
        }

        // Super Admin and Admin remain the technical L1/L2 global identities.
        // They are not part of the department-specific L3-L6 role catalog.
        await client.query(`
          UPDATE roles
             SET access_level = CASE WHEN lower(trim(name)) = 'super admin' THEN 1 ELSE 2 END,
                 department_key = NULL,
                 workforce_role = FALSE,
                 assignment_enabled = TRUE
           WHERE lower(trim(name)) IN ('super admin','admin')
        `);

        // Old/custom role rows are preserved because users may reference them,
        // but they cannot be newly assigned after Step 3. This prevents data loss
        // while making the PDF role catalog the source of truth for new changes.
        await client.query(`
          UPDATE roles
             SET assignment_enabled = FALSE
           WHERE workforce_role = FALSE
             AND lower(trim(name)) NOT IN ('super admin','admin')
        `);

        // Exact existing Workforce roles can be canonicalized safely: the PDF
        // defines one department and one level for each title. No fuzzy role-name
        // mapping is attempted for legacy titles such as Accountant/Support.
        await client.query(`
          UPDATE users u
             SET access_level = r.access_level,
                 department = d.name,
                 designation = CASE WHEN trim(COALESCE(u.designation,'')) = '' THEN r.name ELSE u.designation END
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
