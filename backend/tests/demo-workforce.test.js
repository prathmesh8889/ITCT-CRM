const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { buildDemoWorkforcePlan, DEMO_DOMAIN, DEMO_VERSION, demoTask } = require("../src/demo-workforce-seed");

test("demo workforce creates six employees for every approved department", () => {
  const plan = buildDemoWorkforcePlan();
  assert.equal(DEMO_VERSION, 2);
  assert.equal(plan.length, 84);

  const grouped = new Map();
  for (const row of plan) {
    const list = grouped.get(row.department_key) || [];
    list.push(row);
    grouped.set(row.department_key, list);
  }

  assert.equal(grouped.size, 14);
  for (const [departmentKey, members] of grouped.entries()) {
    assert.equal(members.length, 6, `${departmentKey} must have six demo employees`);
    const levels = members.reduce((acc, member) => {
      acc[member.level] = (acc[member.level] || 0) + 1;
      return acc;
    }, {});
    assert.deepEqual(levels, { 3: 1, 4: 1, 5: 2, 6: 2 });
  }
});

test("each department has one recognizable HOD login identity", () => {
  const plan = buildDemoWorkforcePlan();
  const hods = plan.filter((row) => row.level === 3);
  assert.equal(hods.length, 14);
  assert.equal(new Set(hods.map((row) => row.department_key)).size, 14);
  for (const hod of hods) {
    assert.match(hod.email, /^demo\..+\.l3@workforce\.invalid$/);
    assert.ok(demoTask(hod, hod.department).title.toLowerCase().includes("review"));
  }
});

test("demo identities are unmistakable, unique and non-production", () => {
  const plan = buildDemoWorkforcePlan();
  const emails = new Set(plan.map((row) => row.email));
  assert.equal(emails.size, plan.length);

  for (const row of plan) {
    assert.ok(row.name.startsWith("DEMO · "));
    assert.ok(row.email.endsWith(`@${DEMO_DOMAIN}`));
    assert.ok(row.primary_function.trim().length > 0);
    assert.ok(row.level >= 3 && row.level <= 6);
  }
});

test("department login route exposes scoped employee work panel", () => {
  const root = path.join(__dirname, "..", "..");
  const server = fs.readFileSync(path.join(root, "backend", "src", "server.js"), "utf8");
  const route = fs.readFileSync(path.join(root, "backend", "src", "routes", "department-overview.js"), "utf8");
  const app = fs.readFileSync(path.join(root, "src", "App.tsx"), "utf8");
  const panel = fs.readFileSync(path.join(root, "src", "components", "DepartmentTeamWorkPanel.tsx"), "utf8");

  assert.match(server, /routes\/department-overview/);
  assert.match(route, /workforce\/department-overview/);
  assert.match(route, /scopedUserIds/);
  assert.match(route, /work_items/);
  assert.match(app, /\.l3@workforce\.invalid/);
  assert.match(app, /DepartmentTeamWorkPanel/);
  assert.match(panel, /Department Employees & Current Work/);
});
