const { db } = require("./db");

let ready = false;

async function ensureOrganizationSchema() {
  if (ready) return;
  await db.query(`
    CREATE TABLE IF NOT EXISTS departments (
      id SERIAL PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      description TEXT DEFAULT '',
      allowed_role_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS ux_departments_name_ci ON departments (LOWER(name));

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

  for (const [name, description] of [
    ["Sales", "Sales, lead generation and revenue teams"],
    ["Operations", "Operations and delivery teams"],
  ]) {
    await db.query(
      `INSERT INTO departments (name, description, allowed_role_ids, active)
       VALUES ($1,$2,'[]'::jsonb,TRUE)
       ON CONFLICT (name) DO NOTHING`,
      [name, description],
    );
  }
  ready = true;
}

module.exports = { ensureOrganizationSchema };
