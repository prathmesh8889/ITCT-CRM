/** Workforce employee update enforcement: role, department, team and L1-L6 level stay consistent. */
const express = require("express");
const { db } = require("../db");
const { HttpError } = require("../core");
const { requirePerm } = require("../security");
const { effectiveAccessLevel, canManageAccessLevel } = require("../access-levels");
const { canManageTarget, isGlobalAdmin, norm } = require("../workforce-scope");
const { ensureWorkforceRoleSchema } = require("../workforce-role-schema");
const { ensureTeamSchema } = require("../team-schema");

const router = express.Router();
const safeUser = (u) => { const { password_hash, ...rest } = u; return rest; };

router.patch("/users/:id", requirePerm("employees", "edit"), async (req, res, next) => {
  try {
    await ensureWorkforceRoleSchema();
    await ensureTeamSchema();
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw new HttpError(422, "Invalid employee id");

    const target = await db.one(`
      SELECT u.*, r.name AS role_name, r.access_level AS role_access_level,
             r.department_key AS role_department_key, r.workforce_role,
             r.assignment_enabled
        FROM users u LEFT JOIN roles r ON r.id = u.role_id
       WHERE u.id = $1 AND u.deleted_at IS NULL
    `, [id]);
    if (!target) throw new HttpError(404, "Employee not found");
    if (!canManageTarget(req, target))
      throw new HttpError(403, "You can edit only employees inside your Workforce OS scope");

    const b = req.body || {};
    const roleTouched = b.role_id !== undefined && Number(b.role_id) !== Number(target.role_id);
    const departmentTouched = b.department !== undefined && norm(b.department) !== norm(target.department);
    if (id === req.user.id && (roleTouched || departmentTouched))
      throw new HttpError(400, "You cannot change your own role or department");

    let selectedRole = null;
    let canonicalDepartment = String(target.department || "").trim();
    let nextLevel = effectiveAccessLevel(target, target.role_name || "");
    let designation = b.designation !== undefined ? String(b.designation || "").trim() : String(target.designation || "");
    let isSales = b.is_sales !== undefined ? !!b.is_sales : !!target.is_sales;

    if (b.role_id !== undefined) {
      selectedRole = await db.one("SELECT * FROM roles WHERE id = $1", [Number(b.role_id)]);
      if (!selectedRole) throw new HttpError(422, "Selected role no longer exists");
      const sameExistingLegacyRole = Number(selectedRole.id) === Number(target.role_id) && !selectedRole.assignment_enabled;
      if (!selectedRole.assignment_enabled && !sameExistingLegacyRole)
        throw new HttpError(422, "This legacy role is retired. Select an approved Workforce OS role");

      if (selectedRole.workforce_role) {
        if (!isGlobalAdmin(req) && selectedRole.department_key !== req.role.department_key)
          throw new HttpError(403, "You can assign roles only from your own department");
        const dept = await db.one(
          "SELECT id, name, system_key, active FROM departments WHERE system = TRUE AND system_key = $1",
          [selectedRole.department_key],
        );
        if (!dept || !dept.active) throw new HttpError(422, "The role's approved department is unavailable");
        if (b.department !== undefined && norm(b.department) !== norm(dept.name))
          throw new HttpError(422, `${selectedRole.name} belongs to ${dept.name}. Department and role must match`);
        canonicalDepartment = dept.name;
        nextLevel = Number(selectedRole.access_level);
        designation = selectedRole.name;
        isSales = selectedRole.department_key === "sales-business-development";
      } else if (["Super Admin", "Admin"].includes(selectedRole.name)) {
        if (!isGlobalAdmin(req)) throw new HttpError(403, "Only Super Admin/Admin can assign global administrator roles");
        canonicalDepartment = "";
        nextLevel = selectedRole.name === "Super Admin" ? 1 : 2;
        designation = selectedRole.name;
        isSales = false;
      } else if (b.department !== undefined) {
        canonicalDepartment = String(b.department || "").trim();
      }
    } else if (target.workforce_role) {
      const dept = await db.one(
        "SELECT name FROM departments WHERE system = TRUE AND system_key = $1",
        [target.role_department_key],
      );
      if (dept) {
        if (departmentTouched && norm(b.department) !== norm(dept.name))
          throw new HttpError(422, `${target.role_name} belongs to ${dept.name}. Change the role together with the department`);
        canonicalDepartment = dept.name;
      }
      nextLevel = Number(target.role_access_level || target.access_level);
    } else if (b.department !== undefined) {
      if (!isGlobalAdmin(req) && norm(b.department) !== norm(req.user.department))
        throw new HttpError(403, "You can edit only your assigned department");
      canonicalDepartment = String(b.department || "").trim();
    }

    if (roleTouched) {
      const targetLevel = effectiveAccessLevel(target, target.role_name || "");
      const sameDepartment = !!norm(req.user.department) && norm(req.user.department) === norm(canonicalDepartment);
      if (!canManageAccessLevel(req.accessLevel, targetLevel, nextLevel, { sameDepartment }))
        throw new HttpError(403, "Your access level cannot assign this employee role");
    }

    const name = b.name !== undefined ? String(b.name).trim() : target.name;
    const email = b.email !== undefined ? String(b.email).trim().toLowerCase() : target.email;
    const phone = b.phone !== undefined ? String(b.phone || "").trim() : target.phone;
    const active = b.active !== undefined ? !!b.active : target.active;
    const teamId = b.team_id !== undefined ? (b.team_id == null || b.team_id === "" ? null : Number(b.team_id)) : target.team_id;
    if (!name) throw new HttpError(422, "Name is required");
    if (!/^\S+@\S+\.\S+$/.test(email)) throw new HttpError(422, "Enter a valid email address");
    if (await db.one("SELECT id FROM users WHERE lower(trim(email)) = $1 AND id <> $2 AND deleted_at IS NULL", [email, id]))
      throw new HttpError(409, "Email already exists");

    if (teamId != null) {
      const team = await db.one("SELECT id, name, department, active FROM teams WHERE id = $1", [teamId]);
      if (!team || !team.active) throw new HttpError(422, "Selected team is unavailable");
      if (!canonicalDepartment || norm(team.department) !== norm(canonicalDepartment))
        throw new HttpError(422, `${team.name} is not a ${canonicalDepartment || "global"} department team`);
    }
    if (!isGlobalAdmin(req) && Number(req.accessLevel) === 4 && teamId !== Number(req.user.team_id))
      throw new HttpError(403, "Team Lead can manage only their own team");

    const roleId = b.role_id !== undefined ? Number(b.role_id) : target.role_id;
    const updated = await db.one(`
      UPDATE users SET
        name=$1, email=$2, phone=$3, department=$4, designation=$5,
        role_id=$6, team_id=$7, is_sales=$8, active=$9, access_level=$10
      WHERE id=$11 RETURNING *
    `, [name, email, phone, canonicalDepartment, designation, roleId, teamId, isSales, active, nextLevel, id]);

    await db.query(
      "INSERT INTO audit_logs (user_id, user_name, action, target, detail) VALUES ($1,$2,$3,$4,$5)",
      [req.user.id, req.user.name, roleTouched ? "Workforce Role Changed" : "User Updated", `user:${email}`,
       roleTouched ? `${target.role_name || "No role"} -> ${selectedRole?.name || "No role"}; ${canonicalDepartment}; L${nextLevel}` : name],
    );
    res.json(safeUser(updated));
  } catch (e) { next(e); }
});

module.exports = router;
