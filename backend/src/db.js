/**
 * PostgreSQL access layer. `initSchema()` creates every table idempotently
 * (IF NOT EXISTS) — run automatically on boot when AUTO_MIGRATE=true.
 */
const { Pool } = require("pg");
const { config } = require("./core");

const pool = new Pool({ connectionString: config.databaseUrl, max: 10 });
pool.on("error", (e) => console.error("[db] pool error:", e.message));

const db = {
  query: (text, params) => pool.query(text, params),
  one: async (text, params) => (await pool.query(text, params)).rows[0] || null,
  all: async (text, params) => (await pool.query(text, params)).rows,
  tx: async (fn) => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const out = await fn(client);
      await client.query("COMMIT");
      return out;
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  },
  end: () => pool.end(),
};

const SCHEMA = `
CREATE TABLE IF NOT EXISTS roles (
  id SERIAL PRIMARY KEY, name TEXT UNIQUE NOT NULL, description TEXT DEFAULT '',
  system BOOLEAN DEFAULT FALSE, perms JSONB
);
CREATE TABLE IF NOT EXISTS teams (
  id SERIAL PRIMARY KEY, name TEXT UNIQUE NOT NULL, focus TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL, phone TEXT DEFAULT '',
  password_hash TEXT NOT NULL, department TEXT DEFAULT '', designation TEXT DEFAULT '',
  role_id INT REFERENCES roles(id), team_id INT REFERENCES teams(id),
  reporting_manager_id INT REFERENCES users(id), joining_date DATE,
  is_sales BOOLEAN DEFAULT FALSE, active BOOLEAN DEFAULT TRUE, color TEXT DEFAULT '#0F766E',
  last_login_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT now(), deleted_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id SERIAL PRIMARY KEY, user_id INT REFERENCES users(id), token_hash TEXT UNIQUE NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL, revoked BOOLEAN DEFAULT FALSE, created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_refresh_user ON refresh_tokens(user_id);
CREATE TABLE IF NOT EXISTS lead_statuses (id SERIAL PRIMARY KEY, name TEXT UNIQUE NOT NULL);
CREATE TABLE IF NOT EXISTS lead_sources  (id SERIAL PRIMARY KEY, name TEXT UNIQUE NOT NULL);
CREATE TABLE IF NOT EXISTS leads (
  id SERIAL PRIMARY KEY, lead_code TEXT UNIQUE NOT NULL,
  first_name TEXT DEFAULT '', last_name TEXT DEFAULT '', business_name TEXT NOT NULL,
  company_name TEXT DEFAULT '', contact_person TEXT DEFAULT '',
  email TEXT DEFAULT '', phone TEXT DEFAULT '', alternate_phone TEXT DEFAULT '', whatsapp TEXT DEFAULT '',
  website TEXT DEFAULT '', industry TEXT DEFAULT '', category TEXT DEFAULT '',
  source TEXT DEFAULT 'Manual', source_url TEXT DEFAULT '', address TEXT DEFAULT '',
  city TEXT DEFAULT '', state TEXT DEFAULT '', country TEXT DEFAULT 'India', postal_code TEXT DEFAULT '',
  status TEXT DEFAULT 'New', priority TEXT DEFAULT 'Medium',
  score INT, temperature TEXT, intent TEXT, recommended_action TEXT, ai_reason TEXT DEFAULT '',
  estimated_value NUMERIC(14,2) DEFAULT 0, validation TEXT DEFAULT 'Needs Review',
  assigned_user_id INT REFERENCES users(id), assigned_team_id INT REFERENCES teams(id),
  next_followup_at DATE, notes TEXT DEFAULT '', created_by INT REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now(), deleted_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS ix_leads_status ON leads(status);
CREATE INDEX IF NOT EXISTS ix_leads_assignee ON leads(assigned_user_id);
CREATE TABLE IF NOT EXISTS lead_scores (
  id SERIAL PRIMARY KEY, lead_id INT REFERENCES leads(id), score INT, temperature TEXT,
  intent TEXT, action TEXT, reason TEXT DEFAULT '', scored_by TEXT DEFAULT 'rules',
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS lead_assignments (
  id SERIAL PRIMARY KEY, lead_id INT REFERENCES leads(id), user_id INT REFERENCES users(id),
  team_id INT REFERENCES teams(id), strategy TEXT DEFAULT '', created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS discovery_jobs (
  id SERIAL PRIMARY KEY, created_by INT REFERENCES users(id), category TEXT, location TEXT,
  target INT DEFAULT 20, source TEXT DEFAULT 'maps', keywords TEXT DEFAULT '',
  status TEXT DEFAULT 'Queued', discovered INT DEFAULT 0, valid INT DEFAULT 0,
  duplicates INT DEFAULT 0, invalid INT DEFAULT 0, failed_records INT DEFAULT 0,
  started_at TIMESTAMPTZ, completed_at TIMESTAMPTZ, error TEXT DEFAULT '',
  retry_log JSONB DEFAULT '[]', created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS customers (
  id SERIAL PRIMARY KEY, customer_code TEXT UNIQUE NOT NULL, name TEXT NOT NULL, company TEXT DEFAULT '',
  email TEXT DEFAULT '', phone TEXT DEFAULT '', whatsapp TEXT DEFAULT '',
  gst_number TEXT DEFAULT '', pan_number TEXT DEFAULT '',
  billing_address TEXT DEFAULT '', shipping_address TEXT DEFAULT '',
  city TEXT DEFAULT '', state TEXT DEFAULT '', country TEXT DEFAULT 'India',
  account_manager_id INT REFERENCES users(id), status TEXT DEFAULT 'Active', notes TEXT DEFAULT '',
  lead_id INT REFERENCES leads(id), created_by INT REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT now(), deleted_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS companies (
  id SERIAL PRIMARY KEY, name TEXT NOT NULL, industry TEXT DEFAULT '', website TEXT DEFAULT '',
  phone TEXT DEFAULT '', email TEXT DEFAULT '', gst TEXT DEFAULT '', pan TEXT DEFAULT '',
  address TEXT DEFAULT '', city TEXT DEFAULT '', state TEXT DEFAULT '',
  employee_count INT, annual_revenue NUMERIC(14,2), account_manager_id INT REFERENCES users(id),
  notes TEXT DEFAULT '', created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS contacts (
  id SERIAL PRIMARY KEY, first_name TEXT NOT NULL, last_name TEXT DEFAULT '',
  company_id INT REFERENCES companies(id), designation TEXT DEFAULT '',
  email TEXT DEFAULT '', phone TEXT DEFAULT '', whatsapp TEXT DEFAULT '',
  address TEXT DEFAULT '', city TEXT DEFAULT '', notes TEXT DEFAULT '', created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS deal_stages (
  id SERIAL PRIMARY KEY, key TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
  "order" INT NOT NULL, kind TEXT DEFAULT 'open'
);
CREATE TABLE IF NOT EXISTS deals (
  id SERIAL PRIMARY KEY, name TEXT NOT NULL, lead_id INT REFERENCES leads(id),
  customer_id INT REFERENCES customers(id), company_id INT REFERENCES companies(id),
  stage_id INT REFERENCES deal_stages(id), value NUMERIC(14,2) DEFAULT 0, probability INT DEFAULT 20,
  expected_close_date DATE, assigned_user_id INT REFERENCES users(id),
  product_service TEXT DEFAULT '', description TEXT DEFAULT '',
  closed_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS followups (
  id SERIAL PRIMARY KEY, entity_type TEXT DEFAULT 'lead',
  lead_id INT REFERENCES leads(id), customer_id INT REFERENCES customers(id),
  employee_id INT REFERENCES users(id), type TEXT DEFAULT 'Call', date DATE NOT NULL,
  time TEXT DEFAULT '10:00', reminder BOOLEAN DEFAULT TRUE, status TEXT DEFAULT 'Scheduled',
  notes TEXT DEFAULT '', outcome TEXT DEFAULT '', completed_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS tasks (
  id SERIAL PRIMARY KEY, title TEXT NOT NULL, description TEXT DEFAULT '',
  lead_id INT REFERENCES leads(id), customer_id INT REFERENCES customers(id),
  assigned_to_id INT REFERENCES users(id), created_by_id INT REFERENCES users(id),
  priority TEXT DEFAULT 'Medium', status TEXT DEFAULT 'Pending', due_date DATE,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS meetings (
  id SERIAL PRIMARY KEY, title TEXT NOT NULL, lead_id INT REFERENCES leads(id),
  customer_id INT REFERENCES customers(id), participants JSONB DEFAULT '[]',
  date DATE NOT NULL, start_time TEXT DEFAULT '10:00', end_time TEXT DEFAULT '11:00',
  location TEXT DEFAULT '', meeting_link TEXT DEFAULT '', agenda TEXT DEFAULT '',
  notes TEXT DEFAULT '', outcome TEXT DEFAULT '', created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS calls (
  id SERIAL PRIMARY KEY, lead_id INT REFERENCES leads(id), customer_id INT REFERENCES customers(id),
  direction TEXT DEFAULT 'Outgoing', employee_id INT REFERENCES users(id),
  duration_min INT DEFAULT 0, outcome TEXT DEFAULT 'Connected', notes TEXT DEFAULT '',
  followup_required BOOLEAN DEFAULT FALSE, start_time TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS notes (
  id SERIAL PRIMARY KEY, entity_type TEXT, entity_id INT, body TEXT NOT NULL,
  author_id INT REFERENCES users(id), created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS products (
  id SERIAL PRIMARY KEY, name TEXT NOT NULL, sku TEXT UNIQUE NOT NULL, category TEXT DEFAULT 'General',
  description TEXT DEFAULT '', unit TEXT DEFAULT 'unit', unit_price NUMERIC(14,2) DEFAULT 0,
  gst_percent NUMERIC(5,2) DEFAULT 18, active BOOLEAN DEFAULT TRUE
);
CREATE TABLE IF NOT EXISTS quotations (
  id SERIAL PRIMARY KEY, quotation_number TEXT UNIQUE NOT NULL,
  customer_id INT REFERENCES customers(id), company_id INT REFERENCES companies(id),
  date DATE, valid_until DATE, items JSONB DEFAULT '[]',
  subtotal NUMERIC(14,2) DEFAULT 0, discount_total NUMERIC(14,2) DEFAULT 0,
  tax_total NUMERIC(14,2) DEFAULT 0, grand_total NUMERIC(14,2) DEFAULT 0,
  terms TEXT DEFAULT '', notes TEXT DEFAULT '', status TEXT DEFAULT 'Draft',
  created_by INT REFERENCES users(id), created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS invoices (
  id SERIAL PRIMARY KEY, invoice_number TEXT UNIQUE NOT NULL,
  customer_id INT REFERENCES customers(id), invoice_date DATE, due_date DATE, items JSONB DEFAULT '[]',
  subtotal NUMERIC(14,2) DEFAULT 0, discount_total NUMERIC(14,2) DEFAULT 0,
  tax_total NUMERIC(14,2) DEFAULT 0, grand_total NUMERIC(14,2) DEFAULT 0,
  paid_amount NUMERIC(14,2) DEFAULT 0, balance_due NUMERIC(14,2) DEFAULT 0,
  notes TEXT DEFAULT '', status TEXT DEFAULT 'Draft', quotation_id INT REFERENCES quotations(id),
  created_by INT REFERENCES users(id), created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS payments (
  id SERIAL PRIMARY KEY, payment_number TEXT UNIQUE NOT NULL,
  invoice_id INT REFERENCES invoices(id), customer_id INT REFERENCES customers(id),
  amount NUMERIC(14,2) NOT NULL, payment_date DATE, payment_method TEXT DEFAULT 'UPI',
  transaction_reference TEXT DEFAULT '', notes TEXT DEFAULT '',
  recorded_by INT REFERENCES users(id), created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS expenses (
  id SERIAL PRIMARY KEY, category TEXT DEFAULT 'General', description TEXT DEFAULT '',
  amount NUMERIC(14,2) NOT NULL, date DATE, employee_id INT REFERENCES users(id),
  payment_method TEXT DEFAULT 'UPI', notes TEXT DEFAULT '', created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS activities (
  id SERIAL PRIMARY KEY, actor_id INT REFERENCES users(id), action TEXT, module TEXT,
  record_id INT, meta JSONB, created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS notifications (
  id SERIAL PRIMARY KEY, user_id INT REFERENCES users(id), title TEXT, body TEXT DEFAULT '',
  link TEXT DEFAULT '/dashboard', kind TEXT DEFAULT 'system', read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS audit_logs (
  id SERIAL PRIMARY KEY, user_id INT, user_name TEXT, action TEXT, target TEXT DEFAULT '',
  detail TEXT DEFAULT '', created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS attachments (
  id SERIAL PRIMARY KEY, entity_type TEXT, entity_id INT, filename TEXT, stored_name TEXT,
  size INT, content_type TEXT DEFAULT '', uploaded_by INT REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS automation_rules (
  id SERIAL PRIMARY KEY, name TEXT NOT NULL, trigger TEXT NOT NULL,
  cond_field TEXT DEFAULT '', cond_op TEXT DEFAULT 'eq', cond_value TEXT DEFAULT '',
  actions JSONB DEFAULT '[]', enabled BOOLEAN DEFAULT TRUE
);
CREATE TABLE IF NOT EXISTS automation_executions (
  id SERIAL PRIMARY KEY, rule_id INT, rule_name TEXT, summary TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS ai_logs (
  id SERIAL PRIMARY KEY, kind TEXT, model TEXT, prompt TEXT, output TEXT, ms INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS crm_settings (key TEXT PRIMARY KEY, value JSONB);
CREATE TABLE IF NOT EXISTS message_templates (
  id SERIAL PRIMARY KEY, channel TEXT DEFAULT 'whatsapp', name TEXT, subject TEXT DEFAULT '', body TEXT
);
`;

async function initSchema() {
  await pool.query(SCHEMA);
}

module.exports = { db, pool, initSchema };
