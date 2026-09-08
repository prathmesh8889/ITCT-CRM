/** Enriched department GET: approved Step-3 roles are returned with each system department. */
const express = require("express");
const { db } = require("../db");
const { requirePerm } = require("../security");
const { ensureWorkforceRoleSchema } = require("../workforce-role-schema");

const router = express.Router();

router.get("/departments", requirePerm("employees", "view"), async (_req, res, next) => {
  try {
    await ensureWorkforceRoleSchema();
    const rows = await db.all(`
      SELECT d.*,
        (SELECT COUNT(*)::int FROM users u
          WHERE u.deleted_at IS NULL
            AND lower(trim(COALESCE(u.department,''))) = lower(trim(d.name))) AS member_count,
        CASE WHEN d.system THEN COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'id', r.id,
            'title', r.name,
            'level', r.access_level,
            'primary_function', r.primary_function,
            'department_key', r.department_key,
            'member_count', (SELECT COUNT(*)::int FROM users ru WHERE ru.deleted_at IS NULL AND ru.role_id = r.id)
          ) ORDER BY r.access_level)
          FROM roles r
          WHERE r.workforce_role = TRUE AND r.department_key = d.system_key
        ), '[]'::jsonb) ELSE '[]'::jsonb END AS workforce_roles
      FROM departments d
      ORDER BY d.system DESC, d.sort_order ASC, d.active DESC, d.name ASC
    `);
    res.json(rows);
  } catch (e) { next(e); }
});

module.exports = router;
