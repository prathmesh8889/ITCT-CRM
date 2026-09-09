const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("department overview supports live task and event creation", () => {
  const src = read("src/routes/department-overview.js");
  assert.match(src, /\/workforce\/department-tasks/);
  assert.match(src, /Department Task Assigned/);
  assert.match(src, /\/workforce\/department-events/);
  assert.match(src, /Department Event Created/);
  assert.match(src, /Only Department Heads and Team Leads can assign department work/);
});

test("department overview aggregates work created across CRM modules", () => {
  const src = read("src/routes/department-overview.js");
  for (const table of ["tasks", "workforce_projects", "meetings", "followups", "calendar_events", "workforce_domain_records"])
    assert.ok(src.includes(table), `overview should include ${table}`);
  for (const type of ["Task", "Project", "Meeting", "Follow-up", "Event", "Service Record"])
    assert.ok(src.includes(`type: \"${type}\"`), `overview should expose ${type}`);
});

test("calendar feed is isolated by Workforce department", () => {
  const src = read("src/routes/calendar-view.js");
  assert.match(src, /r\.department_key = \$3/);
  assert.match(src, /This calendar entry belongs to another department/);
});

test("department work panel provides assign task, event and activity UI", () => {
  const src = read(path.join("..", "src", "components", "DepartmentTeamWorkPanel.tsx"));
  assert.ok(src.includes("Assign Task"));
  assert.ok(src.includes("Add Event"));
  assert.ok(src.includes("Department Activity"));
  assert.ok(src.includes("/workforce/department-tasks"));
  assert.ok(src.includes("/workforce/department-events"));
});
