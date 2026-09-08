const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { WORKFORCE_ROLES } = require("../src/workforce-roles");
const { workforcePermissions } = require("../src/workforce-permissions");
const { sanitize, PHONE_MASK, EMAIL_MASK } = require("../src/intern-sanitizer");

const root = path.join(__dirname, "..", "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const role = (title) => WORKFORCE_ROLES.find((x) => x.title === title);
const has = (perms, module, perm) => Array.isArray(perms[module]) && perms[module].includes(perm);

test("Step 4 fixes dashboard-only roles by mapping real CRM modules conservatively", () => {
  const uiux = workforcePermissions(role("UI/UX Lead"));
  assert.ok(has(uiux, "dashboard", "view"));
  assert.ok(has(uiux, "tasks", "view"));
  assert.ok(has(uiux, "tasks", "assign"));
  assert.ok(has(uiux, "meetings", "view"));
  assert.ok(has(uiux, "calendar", "view"));
  assert.ok(has(uiux, "employees", "view"));
  assert.ok(!uiux.leads, "UI/UX must not receive unrelated Sales access");
  assert.ok(!uiux.invoices, "UI/UX must not receive unrelated Finance access");
});

test("department-specific matching modules follow the approved role level", () => {
  const automation = workforcePermissions(role("Automation Engineer"));
  assert.ok(has(automation, "automation", "view"));
  assert.ok(has(automation, "automation", "create"));
  assert.ok(has(automation, "automation", "edit"));
  assert.ok(!has(automation, "automation", "delete"));

  const salesManager = workforcePermissions(role("Sales Manager"));
  assert.ok(has(salesManager, "leads", "assign"));
  assert.ok(has(salesManager, "quotations", "approve"));

  const finance = workforcePermissions(role("Accounts Executive"));
  assert.ok(has(finance, "invoices", "create"));
  assert.ok(has(finance, "payments", "edit"));
});

test("intern permissions deny exports and sensitive live finance surfaces", () => {
  for (const r of WORKFORCE_ROLES.filter((x) => x.level === 6)) {
    const perms = workforcePermissions(r);
    for (const actions of Object.values(perms)) assert.ok(!actions.includes("export"), `${r.title} must never export`);
  }
  const salesIntern = workforcePermissions(role("Sales Intern"));
  assert.deepStrictEqual(salesIntern.leads, ["view"]);
  assert.ok(has(salesIntern, "discovery", "create"));
  const accountsIntern = workforcePermissions(role("Accounts Intern"));
  assert.ok(!accountsIntern.invoices);
  assert.ok(!accountsIntern.payments);
});

test("Level 6 JSON sanitizer masks nested email phone and WhatsApp fields", () => {
  const out = sanitize({
    email: "client@example.com",
    phone: "+919876543210",
    nested: [{ official_email: "a@b.com", whatsapp: "9999999999", title: "ok" }],
  });
  assert.strictEqual(out.email, EMAIL_MASK);
  assert.strictEqual(out.phone, PHONE_MASK);
  assert.strictEqual(out.nested[0].official_email, EMAIL_MASK);
  assert.strictEqual(out.nested[0].whatsapp, PHONE_MASK);
  assert.strictEqual(out.nested[0].title, "ok");
});

test("role schema persists Step 4 permissions instead of dashboard-only baseline", () => {
  const schema = read("backend/src/workforce-role-schema.js");
  assert.match(schema, /workforcePermissions/);
  assert.match(schema, /perms = EXCLUDED\.perms/);
  assert.doesNotMatch(schema, /JSON\.stringify\(\{ dashboard: \["view"\] \}\)/);
});

test("only Super Admin and Admin are globally wide; L3-L6 use scoped ownership", () => {
  const security = read("backend/src/security.js");
  const scope = read("backend/src/workforce-scope.js");
  assert.match(security, /const isWide = \(role\) => SUPER_ROLES\.has\(role\.name\)/);
  assert.doesNotMatch(security, /role\.name === "Sales Manager"/);
  assert.match(scope, /level === 3.*department/s);
  assert.match(scope, /level === 4.*team/s);
  assert.match(scope, /return \[Number\(req\.user\.id\)\]/);
});

test("department and role catalogs are filtered for non-admin sessions", () => {
  const departments = read("backend/src/routes/department-catalog-view.js");
  const roles = read("backend/src/routes/workforce-roles.js");
  const directory = read("backend/src/routes/department-directory.js");
  assert.match(departments, /isGlobalAdmin/);
  assert.match(departments, /lower\(trim\(d\.name\)\).*lower\(trim\(\$1\)\)/s);
  assert.match(roles, /r\.department_key = \$1/);
  assert.match(roles, /router\.get\("\/roles"/);
  assert.match(directory, /scopedUserIds/);
  assert.match(directory, /id = ANY\(\$1::int\[\]\)/);
});

test("CRM list views and dashboards apply department/team row-level owner sets", () => {
  const scoped = read("backend/src/routes/scoped-crm.js");
  const dashboard = read("backend/src/routes/dashboard.js");
  assert.match(scoped, /assigned_user_id = ANY/);
  assert.match(scoped, /account_manager_id = ANY/);
  assert.match(scoped, /created_by = ANY/);
  assert.match(scoped, /Selected employee is outside your Workforce OS scope/);
  assert.match(dashboard, /scopedUserIds/);
  assert.match(dashboard, /assigned_user_id = ANY/);
  assert.match(dashboard, /assigned_to_id = ANY/);
});

test("official role levels are read-only and server activates intern sanitization before protected routes", () => {
  const access = read("backend/src/routes/access-levels.js");
  const server = read("backend/src/server.js");
  const page = read("src/pages/AccessLevels.tsx");
  assert.match(access, /is fixed by .*Change the approved role instead/);
  assert.match(server, /internSanitizer/);
  assert.match(server, /routes\/scoped-crm/);
  assert.match(server, /routes\/department-directory/);
  assert.match(page, /Role-controlled hierarchy/);
  assert.doesNotMatch(page, /onChange=\{\(e\) => void changeLevel/);
});
