const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..", "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

test("active departments page exposes approved roles and a visible employee viewer", () => {
  const app = read("src/App.tsx");
  const src = read("src/pages/DepartmentsV3.tsx");
  assert.match(app, /pages\/DepartmentsV3/);
  assert.match(src, /Add Custom Department/);
  assert.match(src, /Approved Roles/);
  assert.match(src, /View Employees/);
  assert.match(src, /departments\/\$\{row\.id\}\/employees/);
});

test("department members can be moved only through the protected membership endpoint", () => {
  const src = read("src/pages/DepartmentsV3.tsx");
  assert.match(src, /Add \/ Move Employee/);
  assert.match(src, /Remove/);
  assert.match(src, /\/candidates/);
  assert.match(src, /api\.post\(`\/departments\/\$\{memberDepartment\.id\}\/employees`/);
  assert.match(src, /api\.delete\(`\/departments\/\$\{memberDepartment\.id\}\/employees\/\$\{employee\.id\}`/);
});

test("department-member endpoint supports list candidate assign and remove operations", () => {
  const server = read("backend/src/server.js");
  const route = read("backend/src/routes/department-members.js");
  assert.match(server, /department-members/);
  assert.match(route, /router\.get\("\/departments\/:id\/employees"/);
  assert.match(route, /router\.get\("\/departments\/:id\/candidates"/);
  assert.match(route, /router\.post\("\/departments\/:id\/employees"/);
  assert.match(route, /router\.delete\("\/departments\/:id\/employees\/:userId"/);
  assert.match(route, /role_name/);
  assert.match(route, /team_name/);
});

test("department teams have a real route, sidebar page and scoped backend", () => {
  const app = read("src/App.tsx");
  const layout = read("src/components/layout.tsx");
  const page = read("src/pages/Teams.tsx");
  const server = read("backend/src/server.js");
  const route = read("backend/src/routes/workforce-teams.js");
  const schema = read("backend/src/team-schema.js");
  assert.match(app, /path="\/teams"/);
  assert.match(layout, /to: "\/teams", label: "Teams"/);
  assert.match(page, /Create Team/);
  assert.match(page, /Team Lead/);
  assert.match(page, /Focus \/ Project/);
  assert.match(server, /workforce-teams/);
  assert.match(server, /ensureTeamSchema/);
  assert.match(route, /Department Head can manage teams only in their own department/);
  assert.match(route, /Team Lead must be an active L4 employee/);
  assert.match(route, /belongs to another department/);
  assert.match(schema, /ALTER TABLE teams ADD COLUMN IF NOT EXISTS department/);
});

test("department heads can create employees only inside their own department", () => {
  const perms = read("backend/src/workforce-permissions.js");
  const create = read("backend/src/routes/user-create.js");
  const editor = read("src/pages/EmployeeManagement.tsx");
  assert.match(perms, /"employees", \["view", "create", "edit"\]/);
  assert.match(perms, /"teams", \["view", "create", "edit"\]/);
  assert.match(create, /Department Head can add employees only to their own department/);
  assert.match(create, /team\.department/);
  assert.match(editor, /departmentLocked/);
  assert.match(editor, /Fixed to your Department Head scope/);
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

test("legacy AI assistant and Ollama settings cleanup is loaded", () => {
  const css = read("src/cleanup.css");
  const main = read("src/main.tsx");
  const layout = read("src/components/layout.tsx");
  assert.match(css, /assistant/);
  assert.match(main, /cleanup\.css/);
  assert.doesNotMatch(layout, /AI Assistant/);
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

test("floating Workforce shortcuts are removed and moved into desktop/mobile sidebar navigation", () => {
  const app = read("src/App.tsx");
  const layout = read("src/components/layout.tsx");
  assert.doesNotMatch(app, /ProfileShortcut/);
  for (const label of ["Calendar", "Employees", "Teams", "Departments", "Access Levels", "My Profile"])
    assert.ok(layout.includes(label), `sidebar missing ${label}`);
  assert.match(layout, /mobileOpen/);
  assert.match(layout, /md:hidden/);
});
