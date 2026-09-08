const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { DEPARTMENT_CATALOG } = require("../src/departments-catalog");
const { DOMAIN_ENTITIES, accessFor, validateCatalog } = require("../src/department-workspace-spec");

const root = path.join(__dirname, "..", "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

test("all 14 approved departments expose their PDF service matrix", () => {
  assert.strictEqual(DEPARTMENT_CATALOG.length, 14);
  assert.ok(validateCatalog());
  for (const d of DEPARTMENT_CATALOG) {
    assert.ok(Array.isArray(DOMAIN_ENTITIES[d.key]), `${d.name} missing domain entities`);
    assert.ok(DOMAIN_ENTITIES[d.key].length >= 4, `${d.name} must expose at least four services`);
  }
});

test("representative HR Finance PMO Engineering QA and Security matrices match the specification", () => {
  assert.deepStrictEqual(accessFor("hr-people", "payroll-records", 3).actions.sort(), ["approve", "create", "edit", "read"].sort());
  assert.strictEqual(accessFor("hr-people", "payroll-records", 6).actions.length, 0);
  assert.deepStrictEqual(accessFor("finance-accounts", "client-invoices", 5).actions.sort(), ["create", "edit", "read"].sort());
  assert.strictEqual(accessFor("project-management-pmo", "project-budget", 6).actions.length, 0);
  assert.ok(accessFor("web-software-engineering", "code-repositories", 6).restrictions.includes("branch-only"));
  assert.ok(accessFor("qa-testing", "bug-reports", 6).actions.includes("create"));
  assert.strictEqual(accessFor("cybersecurity", "encryption-keys", 4).actions.length, 0);
});

test("HR hiring pipeline is an explicit user-request extension and Intern restrictions remain encoded", () => {
  const hiring = DOMAIN_ENTITIES["hr-people"].find((x) => x.key === "hiring-pipeline");
  assert.ok(hiring);
  assert.strictEqual(hiring.extension, "user-request");
  assert.strictEqual(hiring.pii, true);
  assert.ok(accessFor("sales-business-development", "crm-lead-data", 6).restrictions.includes("masked"));
  assert.ok(accessFor("cybersecurity", "access-logs", 6).restrictions.includes("anonymized"));
  assert.strictEqual(accessFor("finance-accounts", "vendor-payments", 6).actions.length, 0);
  assert.strictEqual(accessFor("ai-automation", "api-keys", 6).actions.length, 0);
});

test("department workspace backend creates service project and intern tables", () => {
  const schema = read("backend/src/workforce-domain-schema.js");
  assert.match(schema, /CREATE TABLE IF NOT EXISTS workforce_domain_records/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS workforce_projects/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS workforce_intern_daily/);
  assert.match(schema, /CHECK \(progress BETWEEN 0 AND 100\)/);
});

test("workspace routes enforce department scope team project scope and Intern protocol", () => {
  const route = read("backend/src/routes/department-workspace.js");
  assert.match(route, /Cross-department workspace access is not allowed/);
  assert.match(route, /Interns receive restricted micro-tasks, not production projects/);
  assert.match(route, /project_manager_id=ANY\(\$1::int\[\]\)/);
  assert.match(route, /assigned_employee_id=ANY\(\$1::int\[\]\)/);
  assert.match(route, /Submit your Daily Work Report before clock-out/);
  assert.match(route, /Intern Workspace Viewed/);
  assert.match(route, /Department Service Record Approved/);
});

test("frontend exposes role-isolated services HR hiring and employee project progress", () => {
  const app = read("src/App.tsx");
  const page = read("src/pages/DepartmentWorkspace.tsx");
  const launch = read("src/components/DepartmentWorkspaceLauncher.tsx");
  assert.match(app, /path="\/department-workspace"/);
  assert.match(page, /Department Services/);
  assert.match(page, /Assigned Projects & Progress/);
  assert.match(page, /Restricted Intern Workspace/);
  assert.match(page, /Add Hiring Candidate/);
  assert.match(launch, /My Department/);
});

test("server mounts and migrates department workspaces before legacy CRM routes", () => {
  const server = read("backend/src/server.js");
  assert.match(server, /ensureWorkforceDomainSchema/);
  const domain = server.indexOf('require(".\/routes\/department-workspace")');
  const legacy = server.indexOf("app.use(\"/api\", crmRoutes)");
  assert.ok(domain >= 0 && legacy >= 0 && domain < legacy);
});
