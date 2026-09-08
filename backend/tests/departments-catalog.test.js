const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { DEPARTMENT_CATALOG } = require("../src/departments-catalog");

const root = path.join(__dirname, "..", "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

const expected = [
  "Executive Management",
  "HR & People Department",
  "Finance & Accounts",
  "Sales & Business Development",
  "Marketing & Growth",
  "Project Management (PMO)",
  "Web & Software Engineering",
  "AI & Automation",
  "UI/UX & Design",
  "QA & Testing",
  "DevOps & IT Infrastructure",
  "Cybersecurity",
  "Customer Success",
  "Admin & Procurement",
];

test("Step 2 defines exactly the 14 approved Workforce OS departments in source order", () => {
  assert.strictEqual(DEPARTMENT_CATALOG.length, 14);
  assert.deepStrictEqual(DEPARTMENT_CATALOG.map((x) => x.name), expected);
  assert.deepStrictEqual(DEPARTMENT_CATALOG.map((x) => x.order), Array.from({ length: 14 }, (_, i) => i + 1));
  for (const d of DEPARTMENT_CATALOG) {
    assert.ok(d.key && d.strategic_context, `${d.name} must have stable metadata and strategic context`);
  }
});

test("department migration replaces old generic defaults without guessing Operations membership", () => {
  const schema = read("backend/src/organization-schema.js");
  assert.match(schema, /Sales & Business Development/);
  assert.match(schema, /Legacy Operations/);
  assert.match(schema, /Never guess a mapping/);
  assert.match(schema, /COUNT\(\*\)::int AS n/);
  assert.match(schema, /allowed_role_ids = '\[\]'::jsonb/);
});

test("approved departments are identifiable, ordered and locked from metadata deletion", () => {
  const schema = read("backend/src/organization-schema.js");
  const route = read("backend/src/routes/organization.js");
  assert.match(schema, /ADD COLUMN IF NOT EXISTS system_key TEXT/);
  assert.match(schema, /ADD COLUMN IF NOT EXISTS system BOOLEAN/);
  assert.match(schema, /ADD COLUMN IF NOT EXISTS sort_order INT/);
  assert.match(route, /d\.system DESC, d\.sort_order ASC/);
  assert.match(route, /system department details are locked/);
  assert.match(route, /Approved Workforce OS departments cannot be deleted/);
});

test("Step 2 removes old role-access editing from the active department UI and reserves it for Step 3", () => {
  const page = read("src/pages/DepartmentsV2.tsx");
  assert.match(page, /Approved Workforce OS Departments/);
  assert.match(page, /Expected catalog: 14/);
  assert.match(page, /Strategic Context/);
  assert.match(page, /reserved for <strong>Step 3<\/strong>/);
  assert.doesNotMatch(page, /Department-wise role access/);
  assert.doesNotMatch(page, /All roles allowed/);
});

test("department employee viewer carries the Step-1 access level into Step 2", () => {
  const members = read("backend/src/routes/department-members.js");
  const page = read("src/pages/DepartmentsV2.tsx");
  assert.match(members, /u\.access_level/);
  assert.match(page, /accessCode\(m\.access_level\)/);
  assert.match(page, /Add \/ Move Employee/);
  assert.match(page, /View Employees/);
});
