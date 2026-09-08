/** PostgreSQL storage for department-specific Workforce OS records and projects. */
const { db } = require("./db");

let ready = null;
function ensureWorkforceDomainSchema() {
  if (!ready) {
    ready = (async () => {
      await db.query(`
        CREATE TABLE IF NOT EXISTS workforce_domain_records (
          id SERIAL PRIMARY KEY,
          department_key TEXT NOT NULL,
          entity_key TEXT NOT NULL,
          title TEXT NOT NULL,
          description TEXT DEFAULT '',
          reference TEXT DEFAULT '',
          status TEXT DEFAULT 'Draft',
          amount NUMERIC(14,2),
          progress INT DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
          due_date DATE,
          shared BOOLEAN DEFAULT FALSE,
          metadata JSONB DEFAULT '{}'::jsonb,
          assigned_user_id INT REFERENCES users(id),
          created_by INT REFERENCES users(id),
          approved_by INT REFERENCES users(id),
          approved_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ DEFAULT now(),
          updated_at TIMESTAMPTZ DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS ix_workforce_domain_department_entity
          ON workforce_domain_records(department_key, entity_key);
        CREATE INDEX IF NOT EXISTS ix_workforce_domain_assignee
          ON workforce_domain_records(assigned_user_id);

        CREATE TABLE IF NOT EXISTS workforce_projects (
          id SERIAL PRIMARY KEY,
          project_code TEXT UNIQUE NOT NULL,
          name TEXT NOT NULL,
          description TEXT DEFAULT '',
          department_key TEXT NOT NULL,
          project_manager_id INT REFERENCES users(id),
          assigned_employee_id INT REFERENCES users(id),
          status TEXT DEFAULT 'Planned',
          progress INT DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
          start_date DATE,
          due_date DATE,
          last_update TEXT DEFAULT '',
          created_by INT REFERENCES users(id),
          created_at TIMESTAMPTZ DEFAULT now(),
          updated_at TIMESTAMPTZ DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS ix_workforce_projects_department
          ON workforce_projects(department_key);
        CREATE INDEX IF NOT EXISTS ix_workforce_projects_employee
          ON workforce_projects(assigned_employee_id);

        CREATE TABLE IF NOT EXISTS workforce_intern_daily (
          id SERIAL PRIMARY KEY,
          user_id INT NOT NULL REFERENCES users(id),
          work_date DATE NOT NULL DEFAULT CURRENT_DATE,
          clock_in TIMESTAMPTZ,
          clock_out TIMESTAMPTZ,
          daily_report TEXT DEFAULT '',
          report_submitted_at TIMESTAMPTZ,
          UNIQUE(user_id, work_date)
        );
      `);
    })().catch((e) => { ready = null; throw e; });
  }
  return ready;
}

module.exports = { ensureWorkforceDomainSchema };
