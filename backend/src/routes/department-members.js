/** Read department members with their real role/team details. */
const express = require("express");
const { db } = require("../db");
const { HttpError } = require("../core");
const { requirePerm } = require("../security");
const { ensureOrganizationSchema } = require("../organization-schema");

const router = express.Router();

router.get("/departments/:id/employees", requirePerm("employees", "view"), async (req, res, next) => {
  try {
    await ensureOrganizationSchema();
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw new HttpError(422, "Invalid department id");

    const department = await db.one("SELECT id, name FROM departments WHERE id = $1", [id]);
    if (!department) throw new HttpError(404, "Department not found");

    const rows = await db.all(
      `SELECT u.id, u.name, u.email, u.phone, u.department, u.designation,
              u.role_id, u.team_id, u.active, u.color, u.last_login_at,
              r.name AS role_name, t.name AS team_name
       FROM users u
       LEFT JOIN roles r ON r.id = u.role_id
       LEFT JOIN teams t ON t.id = u.team_id
       WHERE u.deleted_at IS NULL
         AND lower(trim(COALESCE(u.department, ''))) = lower(trim($1))
       ORDER BY u.active DESC, u.name ASC`,
      [department.name],
    );

    res.json(rows);
  } catch (e) { next(e); }
});

module.exports = router;
