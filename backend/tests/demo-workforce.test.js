const { test } = require("node:test");
const assert = require("node:assert/strict");
const { buildDemoWorkforcePlan, DEMO_DOMAIN } = require("../src/demo-workforce-seed");

test("demo workforce creates six employees for every approved department", () => {
  const plan = buildDemoWorkforcePlan();
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
