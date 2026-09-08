const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { WORKFORCE_ROLES } = require("../src/workforce-roles");
const { DEPARTMENT_CATALOG } = require("../src/departments-catalog");

const root = path.join(__dirname, "..", "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

test("Step 3 defines exactly four approved L3-L6 roles for every approved department", () => {
  assert.strictEqual(WORKFORCE_ROLES.length, 56);
  assert.strictEqual(DEPARTMENT_CATALOG.length, 14);
  for (const department of DEPARTMENT_CATALOG) {
    const roles = WORKFORCE_ROLES.filter((r) => r.department_key === department.key);
    assert.strictEqual(roles.length, 4, `${department.name} must have exactly four roles`);
    assert.deepStrictEqual(roles.map((r) => r.level), [3, 4, 5, 6]);
    assert.ok(roles.every((r) => r.primary_function && r.department === department.name));
  }
});

test("source-defined role titles are preserved exactly for representative departments", () => {
  const names = WORKFORCE_ROLES.map((r) => r.title);
  for (const title of [
    "COO / Operations Head", "Executive Assistant", "Strategy Analyst", "Management Intern",
    "HR Manager", "Recruitment Lead", "HR Operations/Recruiter", "HR Intern",
    "Finance Manager", "Senior Accountant", "Accounts Executive", "Accounts Intern",
    "Sales Manager", "Sales Team Leader", "BDE / SDR", "Sales Intern",
    "Engineering Head", "Tech Lead", "Senior Developer", "Tech Intern",
    "Security Lead", "Security Analyst", "Security Engineer", "Security Intern",
    "Admin Manager", "Admin Lead", "Admin Executive", "Admin Intern",
  ]) assert.ok(names.includes(title), `missing approved role: ${title}`);
});

test("role schema is idempotent, preserves legacy rows and disables legacy assignment", () => {
  const src = read("backend/src/workforce-role-schema.js");
  assert.match(src, /ADD COLUMN IF NOT EXISTS department_key TEXT/);
  assert.match(src, /ADD COLUMN IF NOT EXISTS access_level SMALLINT/);
  assert.match(src, /workforce_role BOOLEAN/);
  assert.match(src, /assignment_enabled BOOLEAN/);
  assert.match(src, /ON CONFLICT \(name\) DO UPDATE/);
  assert.match(src, /assignment_enabled = FALSE/);
  assert.match(src, /lower\(trim\(name\)\) NOT IN \('super admin','admin'\)/);
  assert.doesNotMatch(src, /DELETE FROM roles/);
});

test("manual role mutation APIs are retired while the read catalog remains available", () => {
  const route = read("backend/src/routes/workforce-roles.js");
  assert.match(route, /router\.get\("\/workforce\/roles"/);
  assert.match(route, /router\.post\("\/roles"/);
  assert.match(route, /router\.patch\("\/roles\/:id"/);
  assert.match(route, /router\.put\("\/roles\/:id\/permissions"/);
  assert.match(route, /Roles are managed by the approved Workforce OS specification/);
});

test("employee writes enforce role department and access-level consistency", () => {
  const create = read("backend/src/routes/user-create.js");
  const update = read("backend/src/routes/user-workforce.js");
  const members = read("backend/src/routes/department-members.js");
  assert.match(create, /Department and role must match/);
  assert.match(create, /legacy role is retired/i);
  assert.match(update, /Change the role together with the department/);
  assert.match(update, /canManageAccessLevel/);
  assert.match(members, /Assign this employee an approved Workforce OS role/);
  assert.match(members, /role_department_key !== department\.system_key/);
});

test("Step 3 UI removes floating shortcuts and manual role-permission page from supported navigation", () => {
  const app = read("src/App.tsx");
  const layout = read("src/components/layout.tsx");
  const employee = read("src/pages/EmployeeManagement.tsx");
  const departments = read("src/pages/DepartmentsV3.tsx");
  assert.doesNotMatch(app, /ProfileShortcut/);
  assert.match(app, /path="\/access-settings" element=\{<Navigate to="\/departments" replace \/>\}/);
  assert.match(layout, /label: "Departments"/);
  assert.match(layout, /label: "Access Levels"/);
  assert.match(layout, /My Profile/);
  assert.doesNotMatch(layout, /AI Assistant/);
  assert.match(employee, /Approved Role Assignment/);
  assert.match(employee, /\/workforce\/roles/);
  assert.doesNotMatch(employee, /Roles & Teams/);
  assert.match(departments, /Approved Roles/);
  assert.match(departments, /Expected: 56/);
});
