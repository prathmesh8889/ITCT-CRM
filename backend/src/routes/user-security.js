/** Employee profile + admin password reset endpoints. */
const express = require("express");
const { db } = require("../db");
const { HttpError } = require("../core");
const { requireAuth, requirePerm, rolePerms, hashPassword } = require("../security");
const { ensureAuthSchema } = require("../auth-schema");

const router = express.Router();
const safeUser = (u) => {
  const { password_hash, ...rest } = u;
  return rest;
};

router.get("/users/:id/profile", requireAuth, async (req, res, next) => {
  try {
    await ensureAuthSchema();
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) throw new HttpError(422, "Invalid employee id");
    const isSelf = id === req.user.id;
    if (!isSelf && !rolePerms(req.role.name, req.role.perms, "employees", "view"))
      throw new HttpError(403, "You can only view your own profile");

    const user = await db.one("SELECT * FROM users WHERE id = $1 AND deleted_at IS NULL", [id]);
    if (!user) throw new HttpError(404, "Employee not found");
    const role = user.role_id ? await db.one("SELECT id, name FROM roles WHERE id = $1", [user.role_id]) : null;
    const team = user.team_id ? await db.one("SELECT id, name FROM teams WHERE id = $1", [user.team_id]) : null;
    const [leadCount, taskCount, dealCount, followupCount] = await Promise.all([
      db.one("SELECT COUNT(*)::int AS n FROM leads WHERE assigned_user_id = $1 AND deleted_at IS NULL", [id]),
      db.one("SELECT COUNT(*)::int AS n FROM tasks WHERE assigned_to_id = $1", [id]),
      db.one("SELECT COUNT(*)::int AS n FROM deals WHERE assigned_user_id = $1", [id]),
      db.one("SELECT COUNT(*)::int AS n FROM followups WHERE employee_id = $1", [id]),
    ]);

    res.json({
      user: safeUser(user),
      role: role ? { id: role.id, name: role.name } : null,
      team: team ? { id: team.id, name: team.name } : null,
      summary: {
        leads: leadCount?.n || 0,
        tasks: taskCount?.n || 0,
        deals: dealCount?.n || 0,
        followups: followupCount?.n || 0,
      },
    });
  } catch (e) { next(e); }
});

router.post("/users/:id/reset-password", requirePerm("employees", "edit"), async (req, res, next) => {
  try {
    await ensureAuthSchema();
    const id = Number(req.params.id);
    const password = String(req.body?.password || "");
    if (!Number.isFinite(id)) throw new HttpError(422, "Invalid employee id");
    if (id === req.user.id) throw new HttpError(400, "Use Change Password for your own account");
    if (password.length < 8) throw new HttpError(422, "Temporary password must be at least 8 characters");

    const user = await db.one("SELECT * FROM users WHERE id = $1 AND deleted_at IS NULL", [id]);
    if (!user) throw new HttpError(404, "Employee not found");

    await db.tx(async (c) => {
      await c.query(
        "UPDATE users SET password_hash = $1, must_change_password = TRUE WHERE id = $2",
        [hashPassword(password), id],
      );
      await c.query("UPDATE refresh_tokens SET revoked = TRUE WHERE user_id = $1", [id]);
      await c.query(
        "INSERT INTO audit_logs (user_id, user_name, action, target, detail) VALUES ($1,$2,$3,$4,$5)",
        [req.user.id, req.user.name, "Password Reset", `user:${user.email}`, "Temporary password issued; change required at next login"],
      );
    });

    res.json({ ok: true, must_change_password: true });
  } catch (e) { next(e); }
});

module.exports = router;
