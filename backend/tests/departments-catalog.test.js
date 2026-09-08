const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { DEPARTMENT_CATALOG } = require("../src/departments-catalog");

const root = path.join(__dirname, "..", "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

const expected = [
  "Executive Management", "HR & People Department", "Finance & Accounts",
  "Sales & Business Development", "Marketing & Growth", "Project Management (PMO)",
  "Web & Software Engineering", "AI & Automation", "UI/UX & Design", "QA & Testing",
  "DevOps & IT Infrastructure", "Cybersecurity", "Customer Success", "Admin & Procurement",
];

test("approved department catalog remains exactly 14 departments in source order", () => {
  assert.strictEqual(DEPARTMENT_CATALOG.length, 14);
  assert.deepStrictEqual(DEPARTMENT_CATALOG.map((x) => x.name), expected);
  assert.deepStrictEqual(DEPARTMENT_CATALOG.map((x) => x.order), Array.from({ length: 14 }, (_, i) => i + 1));
  for (const d of DEPARTMENT_CATALOG) assert.ok(d.key && d.strategic_context);
});

test("department migration replaces old generic defaults without guessing Operations membership", () => {
  const schema = read("backend/src/organization-schema.js");
  assert.match(schema, /Sales & Business Development/);
  assert.match(schema, /Legacy Operations/);
  assert.match(schema, /Never guess a mapping/);
  assert.match(schema, /COUNT\(\*\)::int AS n/);
});

test("approved departments remain identifiable ordered and locked", () => {
  const schema = read("backend/src/organization-schema.js");
  const route = read("backend/src/routes/organization.js");
  assert.match(schema, /ADD COLUMN IF NOT EXISTS system_key TEXT/);
  assert.match(schema, /ADD COLUMN IF NOT EXISTS system BOOLEAN/);
  assert.match(schema, /ADD COLUMN IF NOT EXISTS sort_order INT/);
  assert.match(route, /system department details are locked/);
  assert.match(route, /Approved Workforce OS departments cannot be deleted/);
});

test("Step 3 department page exposes approved roles instead of the old role-access editor", () => {
  const app = read("src/App.tsx");
  const page = read("src/pages/DepartmentsV3.tsx");
  assert.match(app, /pages\/DepartmentsV3/);
  assert.match(page, /Approved Workforce OS Departments/);
  assert.match(page, /Approved Roles/);
  assert.match(page, /Expected: 56/);
  assert.doesNotMatch(page, /Department-wise role access/);
  assert.doesNotMatch(page, /All roles allowed/);
});

test("department employee viewer carries access level and role consistency status", () => {
  const members = read("backend/src/routes/department-members.js");
  const page = read("src/pages/DepartmentsV3.tsx");
  assert.match(members, /u\.access_level/);
  assert.match(members, /can_assign/);
  assert.match(page, /levelCode\(m\.access_level\)/);
  assert.match(page, /Add \/ Move Employee/);
  assert.match(page, /View Employees/);
});
