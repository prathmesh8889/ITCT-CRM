/**
 * Backend tests — Node's built-in runner:  npm test
 * Unit tests run without PostgreSQL. Integration tests run when
 * TEST_DATABASE_URL is set (point it at a scratch database).
 */
const { test } = require("node:test");
const assert = require("node:assert");

const { money, computeTotals, validateLead, normPhone, normDomain, parseCSV, toCSV } = require("../src/core");
const { rolePerms } = require("../src/security");

// ---------------- money math (backend authoritative) ----------------
test("money rounds to paise", () => {
  assert.strictEqual(money(10.005), 10.01);
  assert.strictEqual(money("25000"), 25000);
  assert.strictEqual(money(undefined), 0);
});

test("computeTotals applies per-line discount then GST", () => {
  const t = computeTotals([
    { quantity: 2, rate: 10000, discount_percent: 10, gst_percent: 18 },
    { quantity: 1, rate: 5000, discount_percent: 0, gst_percent: 18 },
  ]);
  assert.strictEqual(t.subtotal, 25000);
  assert.strictEqual(t.discount_total, 2000);
  assert.strictEqual(t.tax_total, 4140);           // (20000-2000 + 5000) * 18%
  assert.strictEqual(t.grand_total, 27140);
});

test("payment math: balance = grand_total - paid", () => {
  const totals = computeTotals([{ quantity: 1, rate: 50000, discount_percent: 0, gst_percent: 18 }]);
  assert.strictEqual(totals.grand_total, 59000);
  const paid = 20000;
  assert.strictEqual(money(totals.grand_total - paid), 39000);
});

// ---------------- validation & normalisation ----------------
test("lead validation statuses", () => {
  assert.strictEqual(validateLead({ email: "a@b.co", phone: "+91 9876543210" }), "Valid");
  assert.strictEqual(validateLead({ email: "a@b.co", phone: "" }), "Partially Valid");
  assert.strictEqual(validateLead({ email: "", phone: "" }), "Needs Review");
  assert.strictEqual(validateLead({ email: "bad", phone: "123" }), "Invalid");
});

test("phone/domain normalisation powers duplicate detection", () => {
  assert.strictEqual(normPhone("+91 98-765-43210"), "9876543210");
  assert.strictEqual(normPhone("09876543210"), "9876543210");
  assert.strictEqual(normDomain("https://www.Acme.in/about"), "acme.in");
});

// ---------------- CSV round-trip ----------------
test("CSV parse handles quoted fields and BOM", () => {
  const { records } = parseCSV('\uFEFFBusiness,Contact\n"Acme, Inc","Doe, Jane"\nBeta Corp,Ram');
  assert.strictEqual(records.length, 2);
  assert.strictEqual(records[0].Business, "Acme, Inc");
  assert.strictEqual(records[1].Contact, "Ram");
});

test("CSV export escapes commas and quotes", () => {
  const csv = toCSV([{ a: 'x,y', b: 'say "hi"' }]);
  assert.ok(csv.includes('"x,y"'));
  assert.ok(csv.includes('"say ""hi"""'));
});

// ---------------- RBAC ----------------
test("super roles bypass the permission matrix", () => {
  assert.ok(rolePerms("Super Admin", null, "anything", "delete"));
  assert.ok(rolePerms("Admin", {}, "invoices", "approve"));
});

test("matrix roles are checked strictly", () => {
  const perms = { leads: ["view", "create"] };
  assert.ok(rolePerms("Sales Executive", perms, "leads", "view"));
  assert.ok(!rolePerms("Sales Executive", perms, "leads", "delete"));
  assert.ok(!rolePerms("Sales Executive", perms, "invoices", "view"));
});

// ---------------- guarded integration tests (need TEST_DATABASE_URL) ----------------
const TEST_DB = process.env.TEST_DATABASE_URL;
if (TEST_DB) {
  process.env.DATABASE_URL = TEST_DB;
  const { initSchema, db } = require("../src/db");
  const { app } = require("../src/server");
  const http = require("http");

  test("integration: health, login, CRUD, ownership, refresh rotation", async (t) => {
    await initSchema();
    const server = http.createServer(app);
    await new Promise((r) => server.listen(0, r));
    const base = `http://127.0.0.1:${server.address().port}/api`;
    const j = async (path, opts = {}) => {
      const r = await fetch(base + path, { headers: { "Content-Type": "application/json", ...(opts.headers || {}) }, ...opts });
      return { status: r.status, body: await r.json().catch(() => ({})) };
    };

    t.after(async () => { server.close(); await db.end(); });

    const health = await j("/health");
    assert.strictEqual(health.status, 200);
    assert.strictEqual(health.body.database, "connected");

    // login
    const login = await j("/auth/login", { method: "POST", body: JSON.stringify({ email: "admin@crm.local", password: "Admin@123" }) });
    assert.strictEqual(login.status, 200, "run `npm run seed` against TEST_DATABASE_URL first");
    const token = login.body.access_token;
    const refresh = login.body.refresh_token;
    const H = { Authorization: `Bearer ${token}` };

    const me = await j("/auth/me", { headers: H });
    assert.strictEqual(me.status, 200);
    assert.ok(me.body.perms && me.body.is_super === true);

    // lead create + partial patch
    const lead = await j("/leads", { method: "POST", headers: H, body: JSON.stringify({ business_name: "Integration Test Co", phone: "+91 9000000001" }) });
    assert.strictEqual(lead.status, 201);
    const patch = await j(`/leads/${lead.body.id}`, { method: "PATCH", headers: H, body: JSON.stringify({ status: "Interested" }) });
    assert.strictEqual(patch.status, 200);
    assert.strictEqual(patch.body.status, "Interested");
    assert.strictEqual(patch.body.business_name, "Integration Test Co");

    // paged contract
    const list = await j("/leads?page=1&page_size=5", { headers: H });
    for (const k of ["items", "total", "page", "page_size"]) assert.ok(k in list.body, `missing ${k}`);

    // refresh rotation + reuse rejection
    const r1 = await j("/auth/refresh", { method: "POST", body: JSON.stringify({ refresh_token: refresh }) });
    assert.strictEqual(r1.status, 200);
    const reuse = await j("/auth/refresh", { method: "POST", body: JSON.stringify({ refresh_token: refresh }) });
    assert.strictEqual(reuse.status, 401);
    const r2 = await j("/auth/refresh", { method: "POST", body: JSON.stringify({ refresh_token: r1.body.refresh_token }) });
    assert.strictEqual(r2.status, 401, "family must be revoked after reuse");
  });
}

// ---------------- regression checks ----------------
test("refresh tokens are unique even when created in the same second", () => {
  const { signRefresh } = require("../src/security");
  const user = { id: 123 };
  assert.notStrictEqual(signRefresh(user), signRefresh(user));
});

test("local frontend origin is allowed by the example CORS configuration", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const envExample = fs.readFileSync(path.join(__dirname, "..", ".env.example"), "utf8");
  assert.match(envExample, /CORS_ORIGINS=.*http:\/\/localhost:3000/);
});

test("frontend mutation endpoints exist in the Express routers", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const crm = fs.readFileSync(path.join(__dirname, "..", "src", "routes", "crm.js"), "utf8");
  const admin = fs.readFileSync(path.join(__dirname, "..", "src", "routes", "admin.js"), "utf8");
  for (const route of ["/companies/:id", "/contacts/:id"]) {
    assert.ok(crm.includes(`router.patch(\"${route}\"`), `missing PATCH ${route}`);
  }
  assert.ok(admin.includes('router.patch("/teams/:id"'), "missing PATCH /teams/:id");
});
