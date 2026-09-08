/** Step 3 read-only Workforce role catalog and manual-role mutation blockers. */
const express = require("express");
const { db } = require("../db");
const { HttpError } = require("../core");
const { requirePerm } = require("../security");
const { ensureWorkforceRoleSchema } = require("../workforce-role-schema");

const router = express.Router();

router.get("/workforce/roles", requirePerm("employees", "view"), async (_req, res, next) => {
  try {
    await ensureWorkforceRoleSchema();
    const rows = await db.all(`
      SELECT r.id, r.name, r.description, r.department_key, r.access_level,
             r.primary_function, r.workforce_role, r.assignment_enabled,
             d.name AS department,
             (SELECT COUNT(*)::int FROM users u
               WHERE u.deleted_at IS NULL AND u.role_id = r.id) AS member_count
        FROM roles r
        JOIN departments d ON d.system_key = r.department_key AND d.system = TRUE
       WHERE r.workforce_role = TRUE
       ORDER BY d.sort_order, r.access_level
    `);
    res.json(rows);
  } catch (e) { next(e); }
});

const locked = (_req, _res, next) => next(new HttpError(
  405,
  "Roles are managed by the approved Workforce OS specification. Manual role creation, renaming and permission editing are disabled.",
));

// Keep GET /roles for frontend hydration; only legacy manual mutations are retired.
router.post("/roles", requirePerm("employees", "create"), locked);
router.patch("/roles/:id", requirePerm("employees", "edit"), locked);
router.put("/roles/:id/permissions", requirePerm("employees", "edit"), locked);

module.exports = router;
