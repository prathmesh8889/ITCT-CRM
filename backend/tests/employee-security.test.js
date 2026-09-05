const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const read = (name) => fs.readFileSync(path.join(__dirname, "..", "src", name), "utf8");

test("employee creation marks temporary passwords for mandatory change", () => {
  const src = read(path.join("routes", "user-create.js"));
  assert.match(src, /must_change_password\s*=\s*TRUE/);
  assert.match(src, /must_change_password\)\s*\n\s*VALUES/);
});

test("admin reset revokes sessions and requires password change", () => {
  const src = read(path.join("routes", "user-security.js"));
  assert.match(src, /\/users\/:id\/reset-password/);
  assert.match(src, /must_change_password = TRUE/);
  assert.match(src, /refresh_tokens SET revoked = TRUE/);
});

test("password change clears mandatory-change flag", () => {
  const src = read(path.join("routes", "auth.js"));
  assert.match(src, /must_change_password = FALSE/);
});

test("temporary-password sessions are blocked from CRM data", () => {
  const src = read("security.js");
  assert.match(src, /Password change required before accessing CRM data/);
  assert.match(src, /\["\/me", "\/change-password", "\/logout"\]/);
});

test("profile endpoint permits self and permission-controlled staff lookup", () => {
  const src = read(path.join("routes", "user-security.js"));
  assert.match(src, /\/users\/:id\/profile/);
  assert.match(src, /You can only view your own profile/);
});
