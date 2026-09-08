const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { MODULES } = require("../src/security");

const read = (...parts) => fs.readFileSync(path.join(__dirname, ...parts), "utf8");

test("RBAC exposes calendar and retires AI Assistant permissions", () => {
  assert.ok(MODULES.includes("calendar"), "calendar must be configurable in the role permission matrix");
  assert.ok(!MODULES.includes("ai"), "AI Assistant must not remain in the backend permission catalog");
});

test("organization routes provide department CRUD, calendar CRUD and self-profile edit", () => {
  const source = read("..", "src", "routes", "organization.js");
  for (const fragment of [
    'router.get("/departments"',
    'router.post("/departments"',
    'router.patch("/departments/:id"',
    'router.delete("/departments/:id"',
    'router.get("/calendar/events"',
    'router.post("/calendar/events"',
    'router.patch("/calendar/events/:id"',
    'router.delete("/calendar/events/:id"',
    'router.patch("/users/me/profile"',
    'router.use("/ai"',
  ]) assert.ok(source.includes(fragment), `missing ${fragment}`);
});

test("organization schema creates departments and calendar event tables", () => {
  const source = read("..", "src", "organization-schema.js");
  assert.match(source, /CREATE TABLE IF NOT EXISTS departments/);
  assert.match(source, /allowed_role_ids JSONB/);
  assert.match(source, /CREATE TABLE IF NOT EXISTS calendar_events/);
});

test("frontend routes use dedicated Departments and Calendar pages and no Assistant component", () => {
  const app = read("..", "..", "src", "App.tsx");
  assert.doesNotMatch(app, /pages\/Assistant/);
  assert.match(app, /pages\/Departments/);
  assert.match(app, /pages\/Calendar/);
  assert.match(app, /path="\/departments"/);
  assert.match(app, /path="\/assistant" element=\{<Navigate to="\/dashboard" replace \/>\}/);
});

test("frontend hard-disables legacy AI permissions and supports session refresh after profile edit", () => {
  const store = read("..", "..", "src", "store.tsx");
  assert.match(store, /if \(m === "ai"\) return false/);
  assert.match(store, /refreshMe: \(\) => Promise<void>/);
  const profile = read("..", "..", "src", "pages", "UserProfile.tsx");
  assert.match(profile, /\/users\/me\/profile/);
  assert.match(profile, /Edit profile/);
});
