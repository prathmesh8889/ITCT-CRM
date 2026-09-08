const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..", "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

test("active departments page exposes add/edit and a visible employee viewer", () => {
  const app = read("src/App.tsx");
  const src = read("src/pages/DepartmentsV2.tsx");
  assert.match(app, /pages\/DepartmentsV2/);
  assert.match(src, /Add Department/);
  assert.match(src, /Edit Department Details/);
  assert.match(src, /View Employees/);
  assert.match(src, /departments\/\$\{row\.id\}\/employees/);
});

test("department members can be added, moved and removed from the active modal", () => {
  const src = read("src/pages/DepartmentsV2.tsx");
  assert.match(src, /Add \/ Move Employee/);
  assert.match(src, /Remove from Department/);
  assert.match(src, /\/candidates/);
  assert.match(src, /api\.post\(`\/departments\/\$\{memberDepartment\.id\}\/employees`/);
  assert.match(src, /api\.delete\(`\/departments\/\$\{memberDepartment\.id\}\/employees\/\$\{employee\.id\}`/);
});

test("department-member endpoint supports list, candidate, assign and remove operations", () => {
  const server = read("backend/src/server.js");
  const route = read("backend/src/routes/department-members.js");
  assert.match(server, /department-members/);
  assert.match(route, /router\.get\("\/departments\/:id\/employees"/);
  assert.match(route, /router\.get\("\/departments\/:id\/candidates"/);
  assert.match(route, /router\.post\("\/departments\/:id\/employees"/);
  assert.match(route, /router\.delete\("\/departments\/:id\/employees\/:userId"/);
  assert.match(route, /Employee Removed From Department/);
  assert.match(route, /role_name/);
  assert.match(route, /team_name/);
});

test("calendar uses a normal 42-cell month grid and explicit add buttons", () => {
  const src = read("src/pages/CalendarV2.tsx");
  assert.match(src, /length: 42/);
  assert.match(src, /Add Holiday/);
  assert.match(src, /Add Event/);
});

test("calendar keeps the month usable on phones", () => {
  const src = read("src/pages/CalendarV2.tsx");
  assert.match(src, /overflow-x-auto/);
  assert.match(src, /min-w-\[720px\]/);
  assert.match(src, /Swipe horizontally to view the full month/);
});

test("legacy AI assistant and Ollama settings cleanup is actually loaded", () => {
  const css = read("src/cleanup.css");
  const main = read("src/main.tsx");
  assert.match(css, /assistant/);
  assert.match(css, /nth-child\(2\)/);
  assert.match(main, /cleanup\.css/);
});

test("settings legacy grids are stacked on narrow screens", () => {
  const css = read("src/cleanup.css");
  assert.match(css, /max-width: 639px/);
  assert.match(css, /grid-template-columns: minmax\(0, 1fr\)/);
});

test("company owner settings endpoint is mounted and editor is mobile-safe", () => {
  const server = read("backend/src/server.js");
  const owner = read("backend/src/routes/company-settings.js");
  const editor = read("src/components/CompanyDetailsEditor.tsx");
  assert.match(server, /company-settings/);
  assert.match(owner, /Company Owner/);
  assert.match(owner, /settings\/company/);
  assert.match(editor, /bottom-4/);
  assert.match(editor, /sm:top-\[68px\]/);
});

test("calendar read feed is available to every authenticated user", () => {
  const route = read("backend/src/routes/calendar-view.js");
  assert.match(route, /requireAuth/);
  assert.match(route, /calendar\/events/);
});
