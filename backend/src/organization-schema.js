const { db } = require("./db");
const { DEPARTMENT_CATALOG } = require("./departments-catalog");

let ready = null;
const one = async (client, sql, params = []) => (await client.query(sql, params)).rows[0] || null;
const norm = (value) => String(value || "").trim().toLowerCase();

async function migrateLegacyDepartmentDefaults() {
  await db.tx(async (client) => {
    // The old CRM shipped a generic `Sales` default. The Workforce OS source
    // defines the exact successor as `Sales & Business Development`, so this
    // migration preserves every employee assignment while canonicalizing it.
    const oldSales = await one(client, "SELECT * FROM departments WHERE lower(trim(name)) = 'sales' LIMIT 1");
    if (oldSales) {
      const targetName = "Sales & Business Development";
      const target = await one(
        client,
        "SELECT * FROM departments WHERE lower(trim(name)) = lower($1) AND id <> $2 LIMIT 1",
        [targetName, oldSales.id],
      );
      if (target) {
        await client.query(
          "UPDATE users SET department = $1 WHERE deleted_at IS NULL AND lower(trim(COALESCE(department,''))) = lower(trim($2))",
          [target.name, oldSales.name],
        );
        await client.query("DELETE FROM departments WHERE id = $1", [oldSales.id]);
      } else {
        await client.query("UPDATE departments SET name = $1, updated_at = now() WHERE id = $2", [targetName, oldSales.id]);
        await client.query(
          "UPDATE users SET department = $1 WHERE deleted_at IS NULL AND lower(trim(COALESCE(department,''))) = lower(trim($2))",
          [targetName, oldSales.name],
        );
      }
    }

    // `Operations` was another generic starter department, but the source PDF
    // does not define a direct equivalent. Never guess a mapping. Empty starter
    // rows are removed; rows with members are retained as `Legacy Operations`
    // until an admin explicitly moves those employees into an approved catalog
    // department.
    const operations = await one(
      client,
      "SELECT * FROM departments WHERE lower(trim(name)) = 'operations' AND COALESCE(system,FALSE) = FALSE LIMIT 1",
    );
    if (operations) {
      const count = await one(
        client,
        "SELECT COUNT(*)::int AS n FROM users WHERE deleted_at IS NULL AND lower(trim(COALESCE(department,''))) = lower(trim($1))",
        [operations.name],
      );
      if (!count?.n) {
        await client.query("DELETE FROM departments WHERE id = $1", [operations.id]);
      } else {
        const legacyName = "Legacy Operations";
        const existingLegacy = await one(
          client,
          "SELECT * FROM departments WHERE lower(trim(name)) = lower($1) AND id <> $2 LIMIT 1",
          [legacyName, operations.id],
        );
        if (existingLegacy) {
          await client.query(
            "UPDATE users SET department = $1 WHERE deleted_at IS NULL AND lower(trim(COALESCE(department,''))) = lower(trim($2))",
            [existingLegacy.name, operations.name],
          );
          await client.query("DELETE FROM departments WHERE id = $1", [operations.id]);
        } else {
          const note = "Legacy department retained to protect existing employee assignments. Move members into an approved Workforce OS department before deleting it.";
          const description = String(operations.description || "").trim();
          await client.query(
            `UPDATE departments
                SET name = $1,
                    description = $2,
                    system = FALSE,
                    system_key = NULL,
                    sort_order = 900,
                    updated_at = now()
              WHERE id = $3`,
            [legacyName, description ? `${description}\n\n${note}` : note, operations.id],
          );
          await client.query(
            "UPDATE users SET department = $1 WHERE deleted_at IS NULL AND lower(trim(COALESCE(department,''))) = lower(trim($2))",
            [legacyName, operations.name],
          );
        }
      }
    }
  });
}

async function syncApprovedDepartmentCatalog() {
  await db.tx(async (client) => {
    for (const item of DEPARTMENT_CATALOG) {
      let byKey = await one(client, "SELECT * FROM departments WHERE system_key = $1 LIMIT 1", [item.key]);
      const byName = await one(client, "SELECT * FROM departments WHERE lower(trim(name)) = lower(trim($1)) LIMIT 1", [item.name]);

      if (byKey && byName && byKey.id !== byName.id) {
        await client.query(
          "UPDATE users SET department = $1 WHERE deleted_at IS NULL AND lower(trim(COALESCE(department,''))) = lower(trim($2))",
          [byName.name, byKey.name],
        );
        await client.query("DELETE FROM departments WHERE id = $1", [byKey.id]);
        byKey = null;
      }

      const row = byKey || byName;
      if (row) {
        const previousName = row.name;
        await client.query(
          `UPDATE departments
              SET name = $1,
                  description = $2,
                  system_key = $3,
                  system = TRUE,
                  sort_order = $4,
                  active = TRUE,
                  allowed_role_ids = '[]'::jsonb,
                  updated_at = now()
            WHERE id = $5`,
          [item.name, item.strategic_context, item.key, item.order, row.id],
        );
        if (norm(previousName) !== norm(item.name)) {
          await client.query(
            "UPDATE users SET department = $1 WHERE deleted_at IS NULL AND lower(trim(COALESCE(department,''))) = lower(trim($2))",
            [item.name, previousName],
          );
        }
      } else {
        await client.query(
          `INSERT INTO departments
             (name, description, allowed_role_ids, active, system_key, system, sort_order)
           VALUES ($1,$2,'[]'::jsonb,TRUE,$3,TRUE,$4)`,
          [item.name, item.strategic_context, item.key, item.order],
        );
      }
    }
  });
}

function ensureOrganizationSchema() {
  if (!ready) {
    ready = (async () => {
      await db.query(`
        CREATE TABLE IF NOT EXISTS departments (
          id SERIAL PRIMARY KEY,
          name TEXT UNIQUE NOT NULL,
          description TEXT DEFAULT '',
          allowed_role_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
          active BOOLEAN NOT NULL DEFAULT TRUE,
          system_key TEXT,
          system BOOLEAN NOT NULL DEFAULT FALSE,
          sort_order INT NOT NULL DEFAULT 1000,
          created_at TIMESTAMPTZ DEFAULT now(),
          updated_at TIMESTAMPTZ DEFAULT now()
        );
        ALTER TABLE departments ADD COLUMN IF NOT EXISTS system_key TEXT;
        ALTER TABLE departments ADD COLUMN IF NOT EXISTS system BOOLEAN NOT NULL DEFAULT FALSE;
        ALTER TABLE departments ADD COLUMN IF NOT EXISTS sort_order INT NOT NULL DEFAULT 1000;
        CREATE UNIQUE INDEX IF NOT EXISTS ux_departments_name_ci ON departments (LOWER(name));
        CREATE UNIQUE INDEX IF NOT EXISTS ux_departments_system_key ON departments (system_key) WHERE system_key IS NOT NULL;

        CREATE TABLE IF NOT EXISTS calendar_events (
          id SERIAL PRIMARY KEY,
          title TEXT NOT NULL,
          kind TEXT NOT NULL DEFAULT 'event',
          event_date DATE NOT NULL,
          start_time TEXT DEFAULT '',
          end_time TEXT DEFAULT '',
          all_day BOOLEAN NOT NULL DEFAULT FALSE,
          location TEXT DEFAULT '',
          description TEXT DEFAULT '',
          created_by INT REFERENCES users(id),
          created_at TIMESTAMPTZ DEFAULT now(),
          updated_at TIMESTAMPTZ DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS ix_calendar_events_date ON calendar_events(event_date);
      `);

      await migrateLegacyDepartmentDefaults();
      await syncApprovedDepartmentCatalog();
    })().catch((e) => {
      ready = null;
      throw e;
    });
  }
  return ready;
}

module.exports = { ensureOrganizationSchema };
