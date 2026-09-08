const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const {
  ACCESS_LEVELS,
  inferAccessLevelFromRole,
  canAssignAccessLevel,
  canManageAccessLevel,
} = require("../src/access-levels");

const root = path.join(__dirname, "..", "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

test("access hierarchy defines the six approved organizational levels in order", () => {
  assert.deepStrictEqual(ACCESS_LEVELS.map((x) => x.level), [1, 2, 3, 4, 5, 6]);
  assert.deepStrictEqual(ACCESS_LEVELS.map((x) => x.name), [
    "Super Admin / CEO",
    "Operational Admin / COO",
    "Department Head / HOD",
    "Team Lead",
    "Full-Time Employee",
    "Intern",
  ]);
});

test("legacy roles receive conservative access-level defaults", () => {
  assert.strictEqual(inferAccessLevelFromRole("Super Admin"), 1);
  assert.strictEqual(inferAccessLevelFromRole("Admin"), 2);
  assert.strictEqual(inferAccessLevelFromRole("Sales Manager"), 3);
  assert.strictEqual(inferAccessLevelFromRole("Sales Team Lead"), 4);
  assert.strictEqual(inferAccessLevelFromRole("Sales Executive"), 5);
  assert.strictEqual(inferAccessLevelFromRole("Marketing Intern"), 6);
  assert.strictEqual(inferAccessLevelFromRole("Security Lead"), 5, "ambiguous Lead titles must not be guessed as privileged");
});

test("hierarchy delegation is deny-by-default", () => {
  assert.ok(canAssignAccessLevel(1, 1));
  assert.ok(canAssignAccessLevel(1, 6));
  assert.ok(canAssignAccessLevel(2, 3));
  assert.ok(!canAssignAccessLevel(2, 2));
  assert.ok(!canAssignAccessLevel(2, 1));
  assert.ok(canAssignAccessLevel(3, 4, { sameDepartment: true }));
  assert.ok(!canAssignAccessLevel(3, 4, { sameDepartment: false }));
  assert.ok(!canAssignAccessLevel(4, 5, { sameDepartment: true }));
});

test("non-CEO levels cannot modify peers or higher levels", () => {
  assert.ok(canManageAccessLevel(1, 1, 2));
  assert.ok(canManageAccessLevel(2, 5, 4));
  assert.ok(!canManageAccessLevel(2, 2, 3));
  assert.ok(canManageAccessLevel(3, 5, 6, { sameDepartment: true }));
  assert.ok(!canManageAccessLevel(3, 3, 4, { sameDepartment: true }));
});

test("database migration and auth middleware enforce a valid access-level field", () => {
  const levels = read("backend/src/access-levels.js");
  const security = read("backend/src/security.js");
  assert.match(levels, /ADD COLUMN IF NOT EXISTS access_level SMALLINT/);
  assert.match(levels, /CHECK \(access_level BETWEEN 1 AND 6\)/);
  assert.match(levels, /ALTER COLUMN access_level SET NOT NULL/);
  assert.match(security, /req\.accessLevel = accessLevel/);
  assert.match(security, /Access level is not configured/);
});

test("access-level API protects self-change and audits assignments", () => {
  const route = read("backend/src/routes/access-levels.js");
  assert.match(route, /router\.get\("\/access-levels"/);
  assert.match(route, /router\.patch\("\/users\/:id\/access-level"/);
  assert.match(route, /You cannot change your own access level/);
  assert.match(route, /Access Level Changed/);
  assert.match(route, /canManageAccessLevel/);
});

test("frontend exposes a responsive access-level page without replacing existing departments or roles", () => {
  const app = read("src/App.tsx");
  const page = read("src/pages/AccessLevels.tsx");
  const shortcut = read("src/components/ProfileShortcut.tsx");
  assert.match(app, /path="\/access-levels"/);
  assert.match(page, /6-Level Access Hierarchy/);
  assert.match(page, /Employee Level Assignment/);
  assert.match(page, /Deny-by-default foundation/);
  assert.match(shortcut, /Access Levels/);
  assert.match(app, /path="\/departments"/);
  assert.match(app, /path="\/access-settings"/);
});
