/**
 * Employee creation override.
 *
 * Normalizes email input and restores a previously soft-deleted employee when
 * the same email is reused. New/restored employees must change the temporary
 * password at their next login.
 */
const express = require("express");
const { db } = require("../db");
const { HttpError } = require("../core");
const { requirePerm, hashPassword } = require("../security");
const { ensureAuthSchema } = require("../auth-schema");

const router = express.Router();
const safeUser = (u) => { const { password_hash, ...rest } = u; return rest; };

router.post("/users", requirePerm("employees", "create"), async (req, res, next) => {
  try {
    await ensureAuthSchema();
    const b = req.body || {};
    const name = String(b.name || "").trim();
    const email = String(b.email || "").trim().toLowerCase();
    const password = String(b.password || "");

    if (!name || !email) throw new HttpError(422, "Name and email are required");
    if (!/^\S+@\S+\.\S+$/.test(email)) throw new HttpError(422, "Enter a valid email address");
    if (password.length < 8) throw new HttpError(422, "Temporary password must be at least 8 characters");
    if (!b.role_id) throw new HttpError(422, "Please select an employee role");

    const role = await db.one("SELECT id FROM roles WHERE id = $1", [Number(b.role_id)]);
    if (!role) throw new HttpError(422, "Selected role no longer exists. Refresh the page and choose a role again");
    if (b.team_id != null) {
      const team = await db.one("SELECT id FROM teams WHERE id = $1", [Number(b.team_id)]);
      if (!team) throw new HttpError(422, "Selected team no longer exists. Refresh the page and choose a team again");
    }

    const existing = await db.one("SELECT * FROM users WHERE lower(trim(email)) = $1", [email]);
    if (existing && !existing.deleted_at) {
      throw new HttpError(422, "An active employee with this email already exists");
    }

    let row;
    if (existing?.deleted_at) {
      const r = await db.query(
        `UPDATE users SET
           name = $1, email = $2, phone = $3, password_hash = $4,
           department = $5, designation = $6, role_id = $7, team_id = $8,
           reporting_manager_id = $9, joining_date = $10, is_sales = $11,
           active = $12, color = $13, deleted_at = NULL, last_login_at = NULL,
           must_change_password = TRUE
         WHERE id = $14 RETURNING *`,
        [name, email, String(b.phone || "").trim(), hashPassword(password),
         b.department || "", b.designation || "", Number(b.role_id),
         b.team_id != null ? Number(b.team_id) : null,
         b.reporting_manager_id != null ? Number(b.reporting_manager_id) : null,
         b.joining_date ?? null, b.is_sales ?? false, b.active ?? true,
         b.color || "#0F766E", existing.id],
      );
      await db.query("UPDATE refresh_tokens SET revoked = TRUE WHERE user_id = $1", [existing.id]);
      row = r.rows[0];
      await db.query(
        "INSERT INTO audit_logs (user_id, user_name, action, target, detail) VALUES ($1,$2,$3,$4,$5)",
        [req.user?.id ?? null, req.user?.name ?? "system", "User Restored", `user:${email}`, `${name}; password change required`],
      );
    } else {
      const r = await db.query(
        `INSERT INTO users (name, email, phone, password_hash, department, designation, role_id, team_id,
          reporting_manager_id, joining_date, is_sales, active, color, must_change_password)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,TRUE) RETURNING *`,
        [name, email, String(b.phone || "").trim(), hashPassword(password), b.department || "", b.designation || "",
         Number(b.role_id), b.team_id != null ? Number(b.team_id) : null,
         b.reporting_manager_id != null ? Number(b.reporting_manager_id) : null,
         b.joining_date ?? null, b.is_sales ?? false, b.active ?? true, b.color || "#0F766E"],
      );
      row = r.rows[0];
      await db.query(
        "INSERT INTO audit_logs (user_id, user_name, action, target, detail) VALUES ($1,$2,$3,$4,$5)",
        [req.user?.id ?? null, req.user?.name ?? "system", "User Created", `user:${email}`, `${name}; password change required`],
      );
    }

    res.status(201).json(safeUser(row));
  } catch (e) { next(e); }
});

module.exports = router;
