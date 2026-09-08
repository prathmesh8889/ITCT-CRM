/** Department membership management: list, add/move and remove employees. */
const express = require("express");
const { db } = require("../db");
const { HttpError } = require("../core");
const { requirePerm, SUPER_ROLES } = require("../security");
const { ensureOrganizationSchema } = require("../organization-schema");

const router = express.Router();
const audit = (user, action, target, detail = "") =>
  db.query(
    "INSERT INTO audit_logs (user_id, user_name, action, target, detail) VALUES ($1,$2,$3,$4,$5)",
    [user?.id ?? null, user?.name ?? "system", action, target, detail],
  );

const employeeSelect = `
  SELECT u.id, u.name, u.email, u.phone, u.department, u.designation,
         u.role_id, u.team_id, u.access_level, u.active, u.color, u.last_login_at,
         r.name AS role_name, t.name AS team_name
    FROM users u
    LEFT JOIN roles r ON r.id = u.role_id
    LEFT JOIN teams t ON t.id = u.team_id`;

async function getDepartment(id) {
  await ensureOrganizationSchema();
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
       ORDER BY u.active DESC, u.access_level ASC, u.name ASC`,
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
       ORDER BY (trim(COALESCE(u.department, '')) = '') DESC, u.active DESC, u.access_level ASC, u.name ASC`,
      [department.name],
    );
    res.json(rows);
  } catch (e) { next(e); }
});

router.post("/departments/:id/employees", requirePerm("employees", "edit"), async (req, res, next) => {
  try {
    const department = await getDepartment(Number(req.params.id));
    if (!department.active) throw new HttpError(422, "Enable this department before adding employees");

    const userId = Number(req.body?.user_id);
    if (!Number.isInteger(userId) || userId <= 0) throw new HttpError(422, "Select a valid employee");
    const employee = await db.one(
      `SELECT u.*, r.name AS role_name
         FROM users u
         LEFT JOIN roles r ON r.id = u.role_id
        WHERE u.id = $1 AND u.deleted_at IS NULL`,
      [userId],
    );
    if (!employee) throw new HttpError(404, "Employee not found");

    // Approved Step-2 system departments intentionally do not enforce the old
    // role lists; the exact role matrix is introduced in Step 3. Custom/legacy
    // departments retain old restrictions for backward compatibility.
    const allowed = department.system
      ? []
      : (Array.isArray(department.allowed_role_ids) ? department.allowed_role_ids.map(Number) : []);
    if (
      allowed.length &&
      !allowed.includes(Number(employee.role_id)) &&
      !SUPER_ROLES.has(employee.role_name)
    ) {
      throw new HttpError(422, `${employee.role_name || "This role"} is not allowed in ${department.name}`);
    }

    const previous = String(employee.department || "").trim();
    await db.query("UPDATE users SET department = $1 WHERE id = $2", [department.name, employee.id]);
    await audit(
      req.user,
      previous ? "Employee Moved Department" : "Employee Added To Department",
      `user:${employee.email}`,
      previous ? `${previous} → ${department.name}` : department.name,
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
      `SELECT id, name, email, department FROM users
        WHERE id = $1 AND deleted_at IS NULL`,
      [userId],
    );
    if (!employee) throw new HttpError(404, "Employee not found");
    if (String(employee.department || "").trim().toLowerCase() !== department.name.trim().toLowerCase())
      throw new HttpError(409, "Employee is not assigned to this department");

    await db.query("UPDATE users SET department = '' WHERE id = $1", [employee.id]);
    await audit(req.user, "Employee Removed From Department", `user:${employee.email}`, department.name);
    res.json({ ok: true, user_id: employee.id, department: "" });
  } catch (e) { next(e); }
});

module.exports = router;
