const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..", "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

test("departments page exposes add and edit detail actions", () => {
  const src = read("src/pages/DepartmentsV2.tsx");
  assert.match(src, /Add Department/);
  assert.match(src, /Edit Department Details/);
});

test("calendar uses a normal 42-cell month grid and explicit add buttons", () => {
  const src = read("src/pages/CalendarV2.tsx");
  assert.match(src, /length: 42/);
  assert.match(src, /Add Holiday/);
  assert.match(src, /Add Event/);
});

test("legacy AI assistant and Ollama settings are hidden from the CRM UI", () => {
  const css = read("src/cleanup.css");
  assert.match(css, /assistant/);
  assert.match(css, /nth-child\(2\)/);
});

test("company owner settings endpoint is mounted", () => {
  const server = read("backend/src/server.js");
  const owner = read("backend/src/routes/company-settings.js");
  assert.match(server, /company-settings/);
  assert.match(owner, /Company Owner/);
  assert.match(owner, /settings\/company/);
});

test("calendar read feed is available to every authenticated user", () => {
  const route = read("backend/src/routes/calendar-view.js");
  assert.match(route, /requireAuth/);
  assert.match(route, /calendar\/events/);
});
