/** Read-only Workforce role catalog with department-scoped visibility. */
const express = require("express");
const { db } = require("../db");
const { HttpError } = require("../core");
const { requirePerm } = require("../security");
const { isGlobalAdmin } = require("../workforce-scope");
const { ensureWorkforceRoleSchema } = require("../workforce-role-schema");

const router = express.Router();

router.get("/workforce/roles", requirePerm("employees", "view"), async (req, res, next) => {
  try {
    await ensureWorkforceRoleSchema();
    const params = [];
    let scope = "";
    if (!isGlobalAdmin(req)) {
      if (!req.role?.department_key) return res.json([]);
      params.push(req.role.department_key);
      scope = "AND r.department_key = $1";
    }
    const rows = await db.all(`
      SELECT r.id, r.name, r.description, r.department_key, r.access_level,
             r.primary_function, r.workforce_role, r.assignment_enabled,
             d.name AS department,
             (SELECT COUNT(*)::int FROM users u
               WHERE u.deleted_at IS NULL AND u.role_id = r.id) AS member_count
        FROM roles r
        JOIN departments d ON d.system_key = r.department_key AND d.system = TRUE
       WHERE r.workforce_role = TRUE ${scope}
       ORDER BY d.sort_order, r.access_level
    `, params);
    res.json(rows);
  } catch (e) { next(e); }
});

// Frontend hydration previously received every company role. Step 4 restricts
// non-admin sessions to the four approved roles in their own department.
router.get("/roles", requirePerm("employees", "view"), async (req, res, next) => {
  try {
    await ensureWorkforceRoleSchema();
    if (isGlobalAdmin(req)) {
      return res.json(await db.all("SELECT * FROM roles ORDER BY id"));
    }
    if (!req.role?.department_key) return res.json([req.role]);
    const rows = await db.all(
      `SELECT * FROM roles
        WHERE workforce_role = TRUE AND department_key = $1
        ORDER BY access_level, id`,
      [req.role.department_key],
    );
    res.json(rows);
  } catch (e) { next(e); }
});

const locked = (_req, _res, next) => next(new HttpError(
  405,
  "Roles are managed by the approved Workforce OS specification. Manual role creation, renaming and permission editing are disabled.",
));

router.post("/roles", requirePerm("employees", "create"), locked);
router.patch("/roles/:id", requirePerm("employees", "edit"), locked);
router.put("/roles/:id/permissions", requirePerm("employees", "edit"), locked);

module.exports = router;
