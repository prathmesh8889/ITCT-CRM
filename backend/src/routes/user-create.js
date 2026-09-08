/**
 * Employee creation override with Step-3 Workforce role enforcement.
 * New/restored users receive the exact department + L1-L6 level defined by
 * their approved role. Retired legacy roles cannot be newly assigned.
 */
const express = require("express");
const { db } = require("../db");
const { HttpError } = require("../core");
const { requirePerm, hashPassword } = require("../security");
const { ensureAuthSchema } = require("../auth-schema");
const { canAssignAccessLevel } = require("../access-levels");
const { ensureWorkforceRoleSchema } = require("../workforce-role-schema");

const router = express.Router();
const safeUser = (u) => { const { password_hash, ...rest } = u; return rest; };
const norm = (value) => String(value || "").trim().toLowerCase();

router.post("/users", requirePerm("employees", "create"), async (req, res, next) => {
  try {
    await ensureAuthSchema();
    await ensureWorkforceRoleSchema();
    const b = req.body || {};
    const name = String(b.name || "").trim();
    const email = String(b.email || "").trim().toLowerCase();
    const password = String(b.password || "");

    if (!name || !email) throw new HttpError(422, "Name and email are required");
    if (!/^\S+@\S+\.\S+$/.test(email)) throw new HttpError(422, "Enter a valid email address");
    if (password.length < 8) throw new HttpError(422, "Temporary password must be at least 8 characters");
    if (!b.role_id) throw new HttpError(422, "Please select an employee role");

    const role = await db.one("SELECT * FROM roles WHERE id = $1", [Number(b.role_id)]);
    if (!role) throw new HttpError(422, "Selected role no longer exists. Refresh and choose a role again");
    if (!role.assignment_enabled)
      throw new HttpError(422, "This legacy role is retired. Select an approved Workforce OS role");

    let department = "";
    let designation = role.name;
    let accessLevel = Number(role.access_level || 5);
    let isSales = false;

    if (role.workforce_role) {
      const dept = await db.one(
        "SELECT id, name, active FROM departments WHERE system = TRUE AND system_key = $1",
        [role.department_key],
      );
      if (!dept || !dept.active) throw new HttpError(422, "The role's approved department is unavailable");
      if (b.department !== undefined && norm(b.department) !== norm(dept.name))
        throw new HttpError(422, `${role.name} belongs to ${dept.name}. Department and role must match`);
      department = dept.name;
      accessLevel = Number(role.access_level);
      isSales = role.department_key === "sales-business-development";
    } else if (role.name === "Super Admin") {
      accessLevel = 1;
    } else if (role.name === "Admin") {
      accessLevel = 2;
    } else {
      throw new HttpError(422, "Only approved Workforce OS roles can be assigned to new employees");
    }

    if (b.team_id != null && b.team_id !== "") {
      const team = await db.one("SELECT id FROM teams WHERE id = $1", [Number(b.team_id)]);
      if (!team) throw new HttpError(422, "Selected team no longer exists. Refresh and choose a team again");
    }

    const sameDepartment = !!norm(req.user.department) && norm(req.user.department) === norm(department);
    if (!canAssignAccessLevel(req.accessLevel, accessLevel, { sameDepartment }))
      throw new HttpError(403, "Your access level cannot create an employee at this organizational level");

    const existing = await db.one("SELECT * FROM users WHERE lower(trim(email)) = $1", [email]);
    if (existing && !existing.deleted_at)
      throw new HttpError(422, "An active employee with this email already exists");

    const teamId = b.team_id != null && b.team_id !== "" ? Number(b.team_id) : null;
    let row;
    if (existing?.deleted_at) {
      const r = await db.query(
        `UPDATE users SET
           name=$1, email=$2, phone=$3, password_hash=$4,
           department=$5, designation=$6, role_id=$7, team_id=$8,
           reporting_manager_id=$9, joining_date=$10, is_sales=$11,
           active=$12, color=$13, access_level=$14,
           deleted_at=NULL, last_login_at=NULL, must_change_password=TRUE
         WHERE id=$15 RETURNING *`,
        [name, email, String(b.phone || "").trim(), hashPassword(password),
         department, designation, Number(role.id), teamId,
         b.reporting_manager_id != null ? Number(b.reporting_manager_id) : null,
         b.joining_date ?? null, isSales, b.active ?? true,
         b.color || "#0F766E", accessLevel, existing.id],
      );
      await db.query("UPDATE refresh_tokens SET revoked = TRUE WHERE user_id = $1", [existing.id]);
      row = r.rows[0];
      await db.query(
        "INSERT INTO audit_logs (user_id, user_name, action, target, detail) VALUES ($1,$2,$3,$4,$5)",
        [req.user?.id ?? null, req.user?.name ?? "system", "User Restored", `user:${email}`,
         `${name}; ${role.name}; ${department || "Global"}; L${accessLevel}; password change required`],
      );
    } else {
      const r = await db.query(
        `INSERT INTO users
           (name, email, phone, password_hash, department, designation, role_id, team_id,
            reporting_manager_id, joining_date, is_sales, active, color, access_level, must_change_password)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,TRUE) RETURNING *`,
        [name, email, String(b.phone || "").trim(), hashPassword(password), department, designation,
         Number(role.id), teamId, b.reporting_manager_id != null ? Number(b.reporting_manager_id) : null,
         b.joining_date ?? null, isSales, b.active ?? true, b.color || "#0F766E", accessLevel],
      );
      row = r.rows[0];
      await db.query(
        "INSERT INTO audit_logs (user_id, user_name, action, target, detail) VALUES ($1,$2,$3,$4,$5)",
        [req.user?.id ?? null, req.user?.name ?? "system", "User Created", `user:${email}`,
         `${name}; ${role.name}; ${department || "Global"}; L${accessLevel}; password change required`],
      );
    }

    res.status(201).json(safeUser(row));
  } catch (e) { next(e); }
});

module.exports = router;
