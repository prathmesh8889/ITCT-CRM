/**
 * ITCT CRM seed — realistic demo data for IT CYBER TECHNOLOGIES PVT LTD.
 * Run after the server has created tables (or standalone):  npm run seed
 * Demo login: admin@crm.local / Admin@123  — CHANGE IN PRODUCTION.
 */
const { db, initSchema } = require("./db");
const { hashPassword } = require("./security");
const { money, computeTotals } = require("./core");
const { nextCode } = require("./core");

const rnd = (() => { let s = 20260214; return () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648; })();
const pick = (a) => a[Math.floor(rnd() * a.length)];
const ri = (a, b) => Math.floor(rnd() * (b - a + 1)) + a;
const dOff = (n) => new Date(Date.now() + n * 86400_000).toISOString().slice(0, 10);

const CITIES = [["Pune", "Maharashtra"], ["Mumbai", "Maharashtra"], ["Nagpur", "Maharashtra"],
  ["Bengaluru", "Karnataka"], ["Hyderabad", "Telangana"], ["Chennai", "Tamil Nadu"], ["Delhi", "Delhi"],
  ["Gurugram", "Haryana"], ["Ahmedabad", "Gujarat"], ["Indore", "Madhya Pradesh"], ["Kochi", "Kerala"]];
const CATS = { "Digital Marketing Agency": "Digital Marketing", "Software Company": "Software",
  "Manufacturing": "Manufacturing", "Interior Design": "Interior Design", "Healthcare Clinic": "Healthcare",
  "Fitness & Gym": "Fitness", "Education Institute": "Education", "Real Estate": "Real Estate",
  "E-commerce Store": "E-commerce", "CA & Accounting Firm": "Financial Services",
  "Logistics & Transport": "Logistics", "Cyber Security Services": "Cyber Security" };
const PREFIX = ["Saffron", "Nexbit", "BlueFern", "Trident", "Vertex", "SilverOak", "Prism", "Orchid", "Zenith",
  "Crest", "Maple", "Indigo", "Lotus", "Summit", "Velocity", "Astra", "Nova", "Pinnacle", "Radiant", "Catalyst",
  "Falcon", "Mosaic", "Beacon", "Quantum", "Terra"];
const SUF = ["Technologies", "Solutions", "Enterprises", "Services", "Systems", "Consulting", "Works", "Labs"];
const FIRST = ["Rahul", "Priya", "Amit", "Sneha", "Vikram", "Ananya", "Karan", "Divya", "Nikhil", "Pooja"];
const LAST = ["Deshmukh", "Sharma", "Patel", "Kulkarni", "Singh", "Iyer", "Mehta", "Reddy", "Joshi", "Verma"];
const SOURCES = ["Google Maps", "Website Form", "Referral", "Justdial", "LinkedIn", "Cold Outreach",
  "CSV Import", "Discovery", "IndiaMART", "Walk-in"];

const ROLES = {
  "Super Admin": { description: "Full control of every module", system: true, super: true },
  "Admin": { description: "Manages CRM configuration and data", system: true, super: true },
  "Sales Manager": { description: "Team oversight, assignment and reporting", system: true, perms: {
    dashboard: ["view"], leads: ["view", "create", "edit", "assign", "export"], discovery: ["view", "create", "edit", "delete"],
    customers: ["view", "create", "edit", "export"], companies: ["view", "create", "edit"], contacts: ["view", "create", "edit"],
    deals: ["view", "create", "edit", "assign", "export"], followups: ["view", "create", "edit"],
    tasks: ["view", "create", "edit", "assign"], meetings: ["view", "create", "edit"], calls: ["view", "create"],
    quotations: ["view", "create", "edit", "approve", "export"], invoices: ["view", "create", "edit", "export"],
    payments: ["view", "create"], expenses: ["view"], products: ["view"], employees: ["view"], teams: ["view"],
    reports: ["view", "export"], automation: ["view", "create", "edit"], ai: ["view", "create"],
    notifications: ["view"], settings: ["view"], audit: ["view"] } },
  "Sales Executive": { description: "Works assigned leads and deals", system: true, perms: {
    dashboard: ["view"], leads: ["view", "create", "edit"], customers: ["view", "create"], companies: ["view"],
    contacts: ["view", "create"], deals: ["view", "create", "edit"], followups: ["view", "create", "edit"],
    tasks: ["view", "create", "edit"], meetings: ["view", "create"], calls: ["view", "create"],
    quotations: ["view", "create", "edit"], invoices: ["view"], payments: ["view"],
    reports: ["view"], ai: ["view", "create"], notifications: ["view"] } },
  "Marketing Executive": { description: "Lead discovery and campaigns", system: true, perms: {
    dashboard: ["view"], leads: ["view", "create", "edit", "export"], discovery: ["view", "create", "edit", "delete"],
    customers: ["view"], reports: ["view"], notifications: ["view"] } },
  "Accountant": { description: "Billing, payments and books", system: true, perms: {
    dashboard: ["view"], quotations: ["view", "create", "edit", "export"], invoices: ["view", "create", "edit", "export"],
    payments: ["view", "create", "edit", "export"], expenses: ["view", "create", "edit", "export"],
    customers: ["view"], products: ["view", "create", "edit"], reports: ["view", "export"], notifications: ["view"] } },
  "Support": { description: "Read-only customer context", system: true, perms: {
    dashboard: ["view"], customers: ["view"], tasks: ["view", "create", "edit"], notifications: ["view"] } },
  "Employee": { description: "Basic self-service", system: true, perms: {
    dashboard: ["view"], tasks: ["view", "create", "edit"], notifications: ["view"] } },
};

async function main() {
  await initSchema();
  const exists = await db.one("SELECT id FROM users WHERE email = 'admin@crm.local'");
  if (exists) { console.log("[seed] already seeded — skipping (delete rows to reseed)"); process.exit(0); }

  // roles / teams
  const roleIds = {};
  for (const [name, cfg] of Object.entries(ROLES)) {
    const r = await db.query("INSERT INTO roles (name, description, system, perms) VALUES ($1,$2,$3,$4) RETURNING id",
      [name, cfg.description, cfg.system, cfg.super ? null : JSON.stringify(cfg.perms)]);
    roleIds[name] = r.rows[0].id;
  }
  const teamIds = {};
  for (const [name, focus] of [["Pune Sales Team", "Software & IT services — Pune region"],
    ["West Sales Team", "Marketing & e-commerce — Mumbai/Gujarat"],
    ["Enterprise Team", "High-value custom software & cyber security"]]) {
    const r = await db.query("INSERT INTO teams (name, focus) VALUES ($1,$2) RETURNING id", [name, focus]);
    teamIds[name] = r.rows[0].id;
  }

  // users
  const mkUser = async (name, email, pw, role, team, sales, color) => {
    const r = await db.query(
      `INSERT INTO users (name, email, phone, password_hash, department, designation, role_id, team_id, is_sales, active, color, joining_date)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,TRUE,$10,$11) RETURNING id`,
      [name, email, `+91 98${ri(10000000, 99999999)}`, hashPassword(pw), sales ? "Sales" : "Operations",
       sales ? "Sales Executive" : role, roleIds[role], team ? teamIds[team] : null, sales, color, dOff(-ri(90, 400))]);
    return r.rows[0].id;
  };
  const adminId = await mkUser("Kautuk Ade", "admin@crm.local", "Admin@123", "Super Admin", null, false, "#0F766E");
  await mkUser("Kavya Nair", "kavya@itctcrm.in", "Admin@123", "Admin", null, false, "#7C3AED");
  const mgrId = await mkUser("Rohit Bansal", "rohit@itctcrm.in", "Admin@123", "Sales Manager", null, false, "#B45309");
  const sales = [
    await mkUser("Rahul Deshmukh", "rahul@itctcrm.in", "Sales@123", "Sales Executive", "Pune Sales Team", true, "#2563EB"),
    await mkUser("Priya Sharma", "priya@itctcrm.in", "Sales@123", "Sales Executive", "West Sales Team", true, "#DB2777"),
    await mkUser("Amit Patel", "amit@itctcrm.in", "Sales@123", "Sales Executive", "West Sales Team", true, "#059669"),
    await mkUser("Sneha Kulkarni", "sneha@itctcrm.in", "Sales@123", "Sales Executive", "Pune Sales Team", true, "#D97706"),
    await mkUser("Vikram Singh", "vikram@itctcrm.in", "Sales@123", "Sales Executive", "Enterprise Team", true, "#4F46E5"),
  ];
  const acctId = await mkUser("Neha Joshi", "neha@itctcrm.in", "Sales@123", "Accountant", null, false, "#0891B2");
  console.log("[seed] users ok — Super Admin: admin@crm.local / Admin@123 (change in production!)");

  // lookups & stages
  for (const s of ["New", "Contacted", "Interested", "Follow-up", "Qualified", "Proposal", "Negotiation", "Won", "Lost"])
    await db.query("INSERT INTO lead_statuses (name) VALUES ($1) ON CONFLICT DO NOTHING", [s]);
  for (const s of SOURCES) await db.query("INSERT INTO lead_sources (name) VALUES ($1) ON CONFLICT DO NOTHING", [s]);
  const stageIds = {};
  for (const [key, name, order, kind] of [["new", "New", 1, "open"], ["contacted", "Contacted", 2, "open"],
    ["interested", "Interested", 3, "open"], ["qualified", "Qualified", 4, "open"], ["proposal", "Proposal", 5, "open"],
    ["negotiation", "Negotiation", 6, "open"], ["won", "Won", 7, "won"], ["lost", "Lost", 8, "lost"]]) {
    const r = await db.query(`INSERT INTO deal_stages (key, name, "order", kind) VALUES ($1,$2,$3,$4)
                              ON CONFLICT (key) DO UPDATE SET name = $2 RETURNING id`, [key, name, order, kind]);
    stageIds[key] = r.rows[0].id;
  }

  // 50 leads
  const plan = [["New", 12], ["Contacted", 9], ["Interested", 7], ["Qualified", 6], ["Proposal", 4],
                ["Negotiation", 3], ["Won", 6], ["Lost", 3]];
  const leads = [];
  for (const [status, cnt] of plan) for (let i = 0; i < cnt; i++) {
    const cat = pick(Object.keys(CATS));
    const biz = `${pick(PREFIX)} ${pick(SUF)}`;
    const [city, state] = pick(CITIES);
    const fn = pick(FIRST), ln = pick(LAST);
    const phone = `+91 9${ri(100000000, 999999999)}`;
    const slug = biz.toLowerCase().replace(/[^a-z0-9]+/g, "");
    const hasP = rnd() > .06, hasE = rnd() > .12, hasW = rnd() > .18;
    const score = Math.min(97, 18 + (hasP ? 10 : 0) + (hasE ? 10 : 0) + (hasW ? 10 : 0) +
      (["Pune", "Mumbai", "Bengaluru", "Hyderabad"].includes(city) ? 10 : 0) + ri(0, 25));
    const r = await db.query(
      `INSERT INTO leads (lead_code, first_name, last_name, business_name, company_name, contact_person, email, phone,
        whatsapp, website, industry, category, source, city, state, status, priority, score, temperature, intent,
        recommended_action, ai_reason, estimated_value, validation, assigned_user_id, next_followup_at, created_by)
       VALUES ($1,$2,$3,$4,$4,$5,$6,$7,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25) RETURNING *`,
      [`LD-${Date.now().toString(36).toUpperCase()}-${leads.length.toString(36).toUpperCase().padStart(3, "0")}`,
       fn, ln, biz, `${fn} ${ln}`, hasE ? `${fn.toLowerCase()}.${ln.toLowerCase()}@${slug}.in` : "",
       hasP ? phone : "", hasW ? `www.${slug}.in` : "", CATS[cat], cat, pick(SOURCES), city, state, status,
       pick(["Low", "Medium", "Medium", "High", "Urgent"]), score,
       score >= 75 ? "Hot" : score >= 45 ? "Warm" : "Cold", score >= 75 ? "High" : score >= 45 ? "Medium" : "Low",
       score >= 75 ? pick(["Call", "Demo"]) : score >= 45 ? pick(["WhatsApp", "Email"]) : "Follow-up",
       "Rule-scored from seeded demo data.", pick([25000, 60000, 150000, 200000, 300000]),
       hasP && hasE ? "Valid" : hasP || hasE ? "Partially Valid" : "Needs Review",
       pick(sales), ["New", "Contacted"].includes(status) ? dOff(ri(-2, 5)) : null, mgrId]);
    leads.push(r.rows[0]);
  }
  console.log(`[seed] ${leads.length} leads`);

  // companies / customers / contacts
  const companyDefs = [["Sharma Textiles", "Surat", "Manufacturing"], ["Deshpande Engineering", "Pune", "Manufacturing"],
    ["Krishna Interiors", "Mumbai", "Interior Design"], ["Veda Wellness Clinics", "Bengaluru", "Healthcare"],
    ["Sunrise EduTech", "Hyderabad", "Education"], ["BlueLotus Realty", "Nagpur", "Real Estate"],
    ["Zenith Fitness Club", "Pune", "Fitness"], ["Coastal Marine Logistics", "Kochi", "Logistics"],
    ["SecureNet Systems", "Pune", "Cyber Security"], ["Patel Ceramics", "Morbi", "Manufacturing"]];
  const companies = [];
  for (const [name, city, ind] of companyDefs) {
    const r = await db.query(
      `INSERT INTO companies (name, industry, website, phone, email, gst, city, state, address)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'India',$8) RETURNING *`,
      [name, ind, `www.${name.toLowerCase().replace(/ /g, "")}.in`, `+91 9${ri(100000000, 999999999)}`,
       `hello@${name.toLowerCase().replace(/ /g, "")}.in`, `27${ri(1000000000, 9999999999)}A1Z${ri(1, 9)}`, city,
       `${ri(5, 200)}, Industrial Area, ${city}`]);
    companies.push(r.rows[0]);
  }
  const customers = [];
  for (let i = 0; i < 20; i++) {
    const co = companies[i % companies.length];
    const fn = pick(FIRST), ln = pick(LAST);
    const r = await db.query(
      `INSERT INTO customers (customer_code, name, company, email, phone, whatsapp, gst_number, billing_address,
        city, state, account_manager_id, status, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'India',$10,$11,$12) RETURNING *`,
      [`CU-SEED-${String(i + 1).padStart(3, "0")}`, `${fn} ${ln}`, co.name,
       `${fn.toLowerCase()}@${co.name.toLowerCase().replace(/ /g, "")}.in`, `+91 9${ri(100000000, 999999999)}`,
       `+91 9${ri(100000000, 999999999)}`, co.gst, co.address, co.city, sales[i % 5],
       i % 7 === 6 ? "On Hold" : "Active", adminId]);
    customers.push(r.rows[0]);
  }
  for (let i = 0; i < 20; i++) {
    const co = companies[i % companies.length];
    await db.query("INSERT INTO contacts (first_name, last_name, company_id, designation, email, phone, city) VALUES ($1,$2,$3,$4,$5,$6,$7)",
      [pick(FIRST), pick(LAST), co.id, pick(["Owner", "Director", "Purchase Manager", "CEO"]),
       `contact${i}@${co.name.toLowerCase().replace(/ /g, "")}.in`, `+91 9${ri(100000000, 999999999)}`, co.city]);
  }

  // 20 deals
  const stagePlan = ["new", "new", "new", "contacted", "contacted", "contacted", "interested", "interested",
    "qualified", "qualified", "qualified", "proposal", "proposal", "negotiation", "negotiation", "won", "won", "won", "won", "lost"];
  const dealTitles = ["Website revamp", "CRM implementation", "SEO annual plan", "App development",
    "Security audit", "E-commerce store"];
  for (let i = 0; i < stagePlan.length; i++) {
    const sk = stagePlan[i];
    await db.query(
      `INSERT INTO deals (name, customer_id, stage_id, value, probability, expected_close_date, assigned_user_id, closed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [`${pick(dealTitles)} — ${customers[i % 20].company}`, customers[i % 20].id, stageIds[sk],
       pick([25000, 60000, 120000, 150000, 200000, 300000]),
       { new: 10, contacted: 25, interested: 40, qualified: 55, proposal: 70, negotiation: 85, won: 100, lost: 0 }[sk],
       ["won", "lost"].includes(sk) ? dOff(-ri(3, 40)) : dOff(ri(3, 45)), sales[i % 5],
       ["won", "lost"].includes(sk) ? new Date() : null]);
  }

  // followups / tasks / meetings
  const openLeads = leads.filter((l) => ["New", "Contacted", "Interested", "Qualified", "Proposal"].includes(l.status));
  const fuPlan = [[0, "Scheduled"], [0, "Scheduled"], [0, "Scheduled"], [0, "Completed"], [-1, "Missed"],
    [-2, "Missed"], [-3, "Missed"], [1, "Scheduled"], [1, "Scheduled"], [2, "Scheduled"], [3, "Scheduled"],
    [4, "Scheduled"], [6, "Scheduled"], [-4, "Completed"], [-6, "Completed"], [-8, "Completed"], [8, "Scheduled"], [10, "Scheduled"]];
  fuPlan.forEach(([off, status], i) => {
    const lead = openLeads[i % openLeads.length];
    db.query(`INSERT INTO followups (entity_type, lead_id, employee_id, type, date, time, reminder, status, outcome, completed_at)
              VALUES ('lead',$1,$2,$3,$4,$5,TRUE,$6,$7,$8)`,
      [lead.id, lead.assigned_user_id, pick(["Call", "WhatsApp", "Email", "Demo"]), dOff(off),
       `${ri(10, 17)}:${pick(["00", "30"])}`, status, status === "Completed" ? "Interested" : "",
       status === "Completed" ? new Date() : null]);
  });
  for (let i = 0; i < 12; i++) {
    await db.query(`INSERT INTO tasks (title, assigned_to_id, created_by_id, priority, status, due_date)
                    VALUES ($1,$2,$3,$4,$5,$6)`,
      [pick(["Send proposal deck", "Prepare demo environment", "Collect GST details", "Draft quotation",
        "Verify payment receipt", "Renewal discussion prep"]), sales[i % 5], mgrId,
       pick(["Low", "Medium", "High", "Urgent"]), i < 3 ? "Completed" : i < 7 ? "In Progress" : "Pending", dOff(ri(-3, 9))]);
  }
  for (let i = 0; i < 6; i++) {
    await db.query(`INSERT INTO meetings (title, customer_id, participants, date, start_time, end_time, location, meeting_link, agenda)
                    VALUES ($1,$2,$3,$4,'11:00','12:00',$5,'https://meet.google.com/itct-demo',$6)`,
      [pick(["Product demo — CRM", "Requirement workshop", "Security review", "Proposal walkthrough"]),
       customers[(i * 3) % 20].id, JSON.stringify([sales[i % 5], mgrId]), dOff(i * 2 - 1),
       i % 2 ? "Google Meet" : "Client office", "Understand requirements, present pricing, agree next steps."]);
  }

  // products / quotation / invoices / payments
  const products = [];
  for (const [name, sku, price, cat] of [["Website Development", "WD-01", 25000, "Development"],
    ["CRM Development", "CRM-01", 150000, "Development"], ["Digital Marketing (Monthly)", "DM-01", 15000, "Marketing"],
    ["SEO Package", "SEO-01", 12000, "Marketing"], ["Mobile App Development", "MA-01", 200000, "Development"],
    ["Custom Software Development", "SD-01", 300000, "Development"], ["Annual Maintenance", "AM-01", 24000, "Support"],
    ["E-commerce Store", "EC-01", 60000, "Development"], ["Cyber Security Audit", "CS-01", 85000, "Security"]]) {
    const r = await db.query("INSERT INTO products (name, sku, category, unit, unit_price, gst_percent, active) VALUES ($1,$2,$3,'project',$4,18,TRUE) RETURNING *",
      [name, sku, cat, price]);
    products.push(r.rows[0]);
  }
  const items = (defs) => defs.map(([sku, qty, disc]) => {
    const p = products.find((x) => x.sku === sku);
    return { product_id: p.id, description: p.name, quantity: qty, rate: Number(p.unit_price), discount_percent: disc, gst_percent: 18 };
  });
  const qItems = items([["CRM-01", 1, 8]]);
  const qt = computeTotals(qItems);
  const q = await db.query(
    `INSERT INTO quotations (quotation_number, customer_id, date, valid_until, items, subtotal, discount_total, tax_total,
      grand_total, terms, status, created_by) VALUES ('QT-SEED-013',$1,$2,$3,$4,$5,$6,$7,$8,'Milestones: 40/40/20.','Accepted',$9) RETURNING *`,
    [customers[1].id, dOff(-6), dOff(9), JSON.stringify(qItems), qt.subtotal, qt.discount_total, qt.tax_total, qt.grand_total, sales[1]]);

  const invDefs = [["INV-SEED-031", 1, [["CRM-01", 1, 8]], -4, 11, "Sent", q.rows[0].id],
    ["INV-SEED-030", 6, [["WD-01", 1, 0], ["SEO-01", 2, 0]], -25, -5, "Overdue", null],
    ["INV-SEED-029", 7, [["DM-01", 2, 0]], -32, -12, "Partially Paid", null],
    ["INV-SEED-028", 8, [["EC-01", 1, 5]], -45, -25, "Paid", null],
    ["INV-SEED-027", 9, [["MA-01", 1, 0]], -58, -38, "Paid", null]];
  const invoices = [];
  for (const [numr, ci, defs, d0, d1, status, qid] of invDefs) {
    const it = items(defs); const t = computeTotals(it);
    const r = await db.query(
      `INSERT INTO invoices (invoice_number, customer_id, invoice_date, due_date, items, subtotal, discount_total,
        tax_total, grand_total, paid_amount, balance_due, status, quotation_id, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,0,$10,$11,$12,$13) RETURNING *`,
      [numr, customers[ci].id, dOff(d0), dOff(d1), JSON.stringify(it), t.subtotal, t.discount_total,
       t.tax_total, t.grand_total, t.grand_total, status, qid, acctId]);
    invoices.push(r.rows[0]);
  }
  const payDefs = [[1, 15000, "UPI"], [3, 60000, "Bank Transfer"], [4, 236000, "Cheque"]];
  for (const [idx, amt, method] of payDefs) {
    await db.query(`INSERT INTO payments (payment_number, invoice_id, customer_id, amount, payment_date, payment_method, recorded_by)
                    VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [`PAY-SEED-${idx}${amt}`, invoices[idx].id, invoices[idx].customer_id, amt, dOff(-ri(5, 25)), method, acctId]);
  }
  for (const inv of invoices) {
    const paid = (await db.one("SELECT COALESCE(SUM(amount),0)::float AS p FROM payments WHERE invoice_id = $1", [inv.id])).p;
    const balance = money(Number(inv.grand_total) - paid);
    const status = balance <= 0 ? "Paid" : paid > 0 ? "Partially Paid" : inv.status;
    await db.query("UPDATE invoices SET paid_amount = $1, balance_due = $2, status = $3 WHERE id = $4", [paid, balance, status, inv.id]);
  }

  // automation rules, templates, settings, notifications
  await db.query(`INSERT INTO automation_rules (name, trigger, cond_field, cond_op, cond_value, actions, enabled) VALUES
    ('Hot leads — priority + manager alert','lead.scored','score','gte','80',
     '[{"type":"set_priority","value":"High"},{"type":"notify","value":"managers"},{"type":"followup","value":"4","hours":4,"fuType":"Call"}]',TRUE),
    ('First touch after assignment','lead.assigned','','eq','',
     '[{"type":"followup","value":"24","hours":24,"fuType":"Call"}]',TRUE),
    ('Quotation sent → 2-day follow-up','quote.sent','','eq','',
     '[{"type":"followup","value":"48","hours":48,"fuType":"WhatsApp"}]',TRUE),
    ('Overdue invoice → notify','invoice.overdue','','eq','',
     '[{"type":"notify","value":"managers"}]',TRUE)`);
  for (const [ch, name, body] of [
    ["whatsapp", "Introduction", "Hello {{customer_name}},\n\nI am {{employee_name}} from {{company_name}}. Thank you for your interest in our services.\n\nWould you be available for a quick discussion this week?"],
    ["whatsapp", "Follow-up", "Hi {{customer_name}}, this is {{employee_name}} from {{company_name}}. Just following up on our last conversation."],
    ["whatsapp", "Payment Reminder", "Hello {{customer_name}}, invoice {{invoice_number}} has an outstanding balance of {{amount_due}}. Kindly arrange the payment. — {{company_name}}"],
    ["email", "Introduction", "Hello {{customer_name}},\n\nI am {{employee_name}} from {{company_name}}. Could we schedule a 15-minute call?\n\nRegards,\n{{employee_name}}"],
    ["email", "Invoice", "Hello {{customer_name}},\n\nInvoice {{invoice_number}} ({{amount_due}}) is attached.\n\nRegards,\n{{company_name}}"]]) {
    await db.query("INSERT INTO message_templates (channel, name, subject, body) VALUES ($1,$2,$3,$4)",
      [ch, name, ch === "email" ? name : "", body]);
  }
  const setting = (key, value) => db.query(
    `INSERT INTO crm_settings (key, value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value = $2`,
    [key, JSON.stringify(value)]);
  await setting("company", { name: "IT CYBER TECHNOLOGIES PVT LTD", tagline: "IT Services · Cyber Security · Digital Solutions",
    email: "hello@itctcrm.in", phone: "+91 98220 44551", website: "www.itctcrm.in",
    address: "4th Floor, Trade Centre, FC Road, Pune, MH 411005", gstin: "27AAACN4429F1Z5", pan: "AAACN4429F",
    currency: "INR", timezone: "Asia/Kolkata", logo_mark: "I" });
  await setting("ai", { url: "http://localhost:11434", model: "qwen3", temperature: 0.4, timeout_sec: 30 });
  await setting("scoring", { phone: 10, email: 10, website: 10, location: 10, industry: 15, rating: 5, engagement: 20,
    target_locations: ["Pune", "Mumbai", "Bengaluru", "Hyderabad"],
    target_industries: ["Software", "Digital Marketing", "E-commerce", "Manufacturing", "Real Estate", "Cyber Security"] });
  await setting("assignment", { strategy: "round_robin", rr_pointer: 0, high_value_threshold: 100000,
    high_value_user_id: sales[4], category_map: { "Software Company": sales[0] }, location_map: { Pune: sales[0], Mumbai: sales[1] } });
  await db.query("INSERT INTO notifications (user_id, title, body, link, kind) VALUES (NULL,'Welcome to ITCT CRM','Seed data loaded — explore leads, pipeline and invoices.','/dashboard','system')");

  console.log("[seed] done — login: admin@crm.local / Admin@123");
  process.exit(0);
}

main().catch((e) => { console.error("[seed] FAILED:", e.message); process.exit(1); });
