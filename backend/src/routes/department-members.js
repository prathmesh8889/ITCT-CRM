/** Department membership management with Step-3 role/department consistency. */
const express = require("express");
const { db } = require("../db");
const { HttpError } = require("../core");
const { requirePerm } = require("../security");
const { ensureWorkforceRoleSchema } = require("../workforce-role-schema");

const router = express.Router();
const audit = (user, action, target, detail = "") =>
  db.query(
    "INSERT INTO audit_logs (user_id, user_name, action, target, detail) VALUES ($1,$2,$3,$4,$5)",
    [user?.id ?? null, user?.name ?? "system", action, target, detail],
  );

const employeeSelect = `
  SELECT u.id, u.name, u.email, u.phone, u.department, u.designation,
         u.role_id, u.team_id, u.access_level, u.active, u.color, u.last_login_at,
         r.name AS role_name, r.department_key AS role_department_key,
         r.access_level AS role_access_level, r.primary_function,
         r.workforce_role, r.assignment_enabled,
         rd.name AS role_department, t.name AS team_name
  FROM users u
  LEFT JOIN roles r ON r.id = u.role_id
  LEFT JOIN departments rd ON rd.system_key = r.department_key AND rd.system = TRUE
  LEFT JOIN teams t ON t.id = u.team_id`;

async function getDepartment(id) {
  await ensureWorkforceRoleSchema();
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(422, "Invalid department id");
  const department = await db.one("SELECT * FROM departments WHERE id = $1", [id]);
  if (!department) throw new HttpError(404, "Department not found");
  return department;
}

router.get("/departments/:id/employees", requirePerm("employees", "view"), async (req, res, next) => {
  try {
    const department = await getDepartment(Number(req.params.id));
    const rows = await db.all(
      `${employeeSelect}
       WHERE u.deleted_at IS NULL
         AND lower(trim(COALESCE(u.department, ''))) = lower(trim($1))
       ORDER BY u.active DESC, u.access_level, u.name ASC`,
      [department.name],
    );
    res.json(rows);
  } catch (e) { next(e); }
});

router.get("/departments/:id/candidates", requirePerm("employees", "view"), async (req, res, next) => {
  try {
    const department = await getDepartment(Number(req.params.id));
    const rows = await db.all(
      `${employeeSelect}
       WHERE u.deleted_at IS NULL
         AND lower(trim(COALESCE(u.department, ''))) <> lower(trim($1))
       ORDER BY (trim(COALESCE(u.department, '')) = '') DESC, u.active DESC, u.name ASC`,
      [department.name],
    );
    res.json(rows.map((row) => ({
      ...row,
      can_assign: department.system
        ? !!row.workforce_role && row.role_department_key === department.system_key
        : !row.workforce_role,
      assignment_reason: department.system
        ? (!row.workforce_role
            ? "Assign an approved Workforce OS role first"
            : row.role_department_key !== department.system_key
              ? `${row.role_name} belongs to ${row.role_department || "another approved department"}`
              : "")
        : (row.workforce_role ? `${row.role_name} must stay in ${row.role_department}` : ""),
    })));
  } catch (e) { next(e); }
});

router.post("/departments/:id/employees", requirePerm("employees", "edit"), async (req, res, next) => {
  try {
    const department = await getDepartment(Number(req.params.id));
    if (!department.active) throw new HttpError(422, "Enable this department before adding employees");

    const userId = Number(req.body?.user_id);
    if (!Number.isInteger(userId) || userId <= 0) throw new HttpError(422, "Select a valid employee");
    const employee = await db.one(
      `SELECT u.*, r.name AS role_name, r.department_key AS role_department_key,
              r.access_level AS role_access_level, r.workforce_role,
              rd.name AS role_department
         FROM users u
         LEFT JOIN roles r ON r.id = u.role_id
         LEFT JOIN departments rd ON rd.system_key = r.department_key AND rd.system = TRUE
        WHERE u.id = $1 AND u.deleted_at IS NULL`,
      [userId],
    );
    if (!employee) throw new HttpError(404, "Employee not found");

    if (department.system) {
      if (!employee.workforce_role)
        throw new HttpError(422, "Assign this employee an approved Workforce OS role before moving them into an approved department");
      if (employee.role_department_key !== department.system_key)
        throw new HttpError(422, `${employee.role_name} belongs to ${employee.role_department || "another approved department"}. Change the role first`);
    } else if (employee.workforce_role) {
      throw new HttpError(422, `${employee.role_name} is an approved role and must stay in ${employee.role_department}. Change the role before using a custom department`);
    }

    const previous = String(employee.department || "").trim();
    await db.query(
      "UPDATE users SET department=$1, access_level=COALESCE($2, access_level) WHERE id=$3",
      [department.name, employee.workforce_role ? Number(employee.role_access_level) : null, employee.id],
    );
    await audit(
      req.user,
      previous ? "Employee Moved Department" : "Employee Added To Department",
      `user:${employee.email}`,
      previous ? `${previous} -> ${department.name}` : department.name,
    );

    res.json({ ok: true, user_id: employee.id, department: department.name, previous_department: previous });
  } catch (e) { next(e); }
});

router.delete("/departments/:id/employees/:userId", requirePerm("employees", "edit"), async (req, res, next) => {
  try {
    const department = await getDepartment(Number(req.params.id));
    const userId = Number(req.params.userId);
    if (!Number.isInteger(userId) || userId <= 0) throw new HttpError(422, "Invalid employee id");

    const employee = await db.one(
      `SELECT u.id, u.name, u.email, u.department, r.name AS role_name, r.workforce_role
         FROM users u LEFT JOIN roles r ON r.id = u.role_id
        WHERE u.id = $1 AND u.deleted_at IS NULL`,
      [userId],
    );
    if (!employee) throw new HttpError(404, "Employee not found");
    if (String(employee.department || "").trim().toLowerCase() !== department.name.trim().toLowerCase())
      throw new HttpError(409, "Employee is not assigned to this department");
    if (department.system && employee.workforce_role)
      throw new HttpError(422, `${employee.role_name} requires an approved department. Change the employee role/department together from Employee Management`);

    await db.query("UPDATE users SET department = '' WHERE id = $1", [employee.id]);
    await audit(req.user, "Employee Removed From Department", `user:${employee.email}`, department.name);
    res.json({ ok: true, user_id: employee.id, department: "" });
  } catch (e) { next(e); }
});

module.exports = router;
