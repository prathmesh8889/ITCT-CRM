/** Access-level catalog and controlled employee level assignment. */
const express = require("express");
const { db } = require("../db");
const { HttpError } = require("../core");
const { requirePerm } = require("../security");
const {
  ACCESS_LEVELS,
  isValidAccessLevel,
  effectiveAccessLevel,
  canManageAccessLevel,
  ensureAccessLevelSchema,
} = require("../access-levels");

const router = express.Router();
const safeUser = (u) => { const { password_hash, ...rest } = u; return rest; };
const audit = (user, action, target, detail = "") =>
  db.query(
    "INSERT INTO audit_logs (user_id, user_name, action, target, detail) VALUES ($1,$2,$3,$4,$5)",
    [user?.id ?? null, user?.name ?? "system", action, target, detail],
  );
const normalizedDepartment = (value) => String(value || "").trim().toLowerCase();

router.get("/access-levels", requirePerm("employees", "view"), async (_req, res, next) => {
  try {
    await ensureAccessLevelSchema();
    const counts = await db.all(`
      SELECT access_level AS level, COUNT(*)::int AS member_count
        FROM users
       WHERE deleted_at IS NULL
       GROUP BY access_level
    `);
    const byLevel = new Map(counts.map((x) => [Number(x.level), Number(x.member_count) || 0]));
    res.json({
      levels: ACCESS_LEVELS.map((x) => ({ ...x, member_count: byLevel.get(x.level) || 0 })),
      policy: "deny-by-default",
      note: "Organizational level foundation. Department/team data scoping and intern masking are applied in later implementation steps.",
    });
  } catch (e) { next(e); }
});

router.patch("/users/:id/access-level", requirePerm("employees", "edit"), async (req, res, next) => {
  try {
    await ensureAccessLevelSchema();
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw new HttpError(422, "Invalid employee id");
    if (id === req.user.id) throw new HttpError(400, "You cannot change your own access level");

    const nextLevel = Number(req.body?.access_level);
    if (!isValidAccessLevel(nextLevel)) throw new HttpError(422, "access_level must be an integer from 1 to 6");

    const target = await db.one(`
      SELECT u.*, r.name AS role_name
        FROM users u
        LEFT JOIN roles r ON r.id = u.role_id
       WHERE u.id = $1 AND u.deleted_at IS NULL
    `, [id]);
    if (!target) throw new HttpError(404, "Employee not found");

    const actorLevel = Number(req.accessLevel || effectiveAccessLevel(req.user, req.role?.name));
    const targetLevel = effectiveAccessLevel(target, target.role_name || "");
    const actorDept = normalizedDepartment(req.user.department);
    const targetDept = normalizedDepartment(target.department);
    const sameDepartment = !!actorDept && actorDept === targetDept;

    if (!canManageAccessLevel(actorLevel, targetLevel, nextLevel, { sameDepartment })) {
      throw new HttpError(403, "Your access level cannot assign or modify this employee level");
    }

    // Preserve the two existing system-admin identities. Their role-level pair
    // must stay consistent so the old role permission engine cannot bypass the
    // new organizational hierarchy.
    const roleName = String(target.role_name || "").trim();
    if (roleName === "Super Admin" && nextLevel !== 1)
      throw new HttpError(422, "A Super Admin account must remain Level 1");
    if (roleName === "Admin" && nextLevel !== 2)
      throw new HttpError(422, "An Admin account must remain Level 2");

    const updated = await db.one(
      "UPDATE users SET access_level = $1 WHERE id = $2 RETURNING *",
      [nextLevel, id],
    );
    await audit(
      req.user,
      "Access Level Changed",
      `user:${target.email}`,
      `L${targetLevel} -> L${nextLevel}; ${target.name}`,
    );
    res.json(safeUser(updated));
  } catch (e) { next(e); }
});

module.exports = router;
