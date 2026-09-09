/** Scoped department roster + current work overview for Workforce OS. */
const express = require("express");
const { db } = require("../db");
const { HttpError } = require("../core");
const { requireAuth, SUPER_ROLES } = require("../security");
const { scopedUserIds } = require("../workforce-scope");
const { DEPARTMENT_CATALOG, DEPARTMENT_BY_KEY } = require("../departments-catalog");
const { ensureWorkforceDomainSchema } = require("../workforce-domain-schema");

const router = express.Router();
const clean = (v) => String(v || "").trim();
const isAdmin = (req) => SUPER_ROLES.has(req.role?.name);

async function resolveDepartmentKey(req) {
  if (isAdmin(req)) {
    const requested = clean(req.query.department_key);
    const key = requested || DEPARTMENT_CATALOG[0]?.key;
    if (!key || !DEPARTMENT_BY_KEY.has(key)) throw new HttpError(422, "Unknown Workforce OS department");
    return key;
  }
  const key = clean(req.role?.department_key);
  if (!key || !DEPARTMENT_BY_KEY.has(key)) throw new HttpError(403, "Your role is not linked to an approved department");
  if (req.query.department_key && clean(req.query.department_key) !== key)
    throw new HttpError(403, "Cross-department overview access is not allowed");
  return key;
}

router.get("/workforce/department-overview", requireAuth, async (req, res, next) => {
  try {
    await ensureWorkforceDomainSchema();
    const key = await resolveDepartmentKey(req);
    const department = DEPARTMENT_BY_KEY.get(key);

    const where = ["u.deleted_at IS NULL", "u.active = TRUE", "r.department_key = $1"];
    const params = [key];
    if (!isAdmin(req)) {
      const ids = (await scopedUserIds(req)) || [];
      params.push(ids.length ? ids : [-1]);
      where.push("u.id = ANY($2::int[])");
    }

    const employees = await db.all(`
      SELECT u.id,u.name,u.email,u.phone,u.access_level,u.department,u.designation,
             u.team_id,u.reporting_manager_id,u.color,u.last_login_at,
             r.name AS role_name,r.primary_function,t.name AS team_name,
             rm.name AS reporting_manager_name
        FROM users u
        JOIN roles r ON r.id=u.role_id
        LEFT JOIN teams t ON t.id=u.team_id
        LEFT JOIN users rm ON rm.id=u.reporting_manager_id
       WHERE ${where.join(" AND ")}
       ORDER BY u.access_level ASC,u.name ASC
    `, params);

    const ids = employees.map((x) => Number(x.id));
    let tasks = [];
    let projects = [];
    if (ids.length) {
      tasks = await db.all(`
        SELECT id,title,description,priority,status,due_date,assigned_to_id
          FROM tasks
         WHERE assigned_to_id = ANY($1::int[])
         ORDER BY CASE status WHEN 'In Progress' THEN 0 WHEN 'Pending' THEN 1 ELSE 2 END,
                  due_date NULLS LAST,id DESC
      `, [ids]);
      projects = await db.all(`
        SELECT id,project_code,name,description,status,progress,due_date,last_update,assigned_employee_id
          FROM workforce_projects
         WHERE assigned_employee_id = ANY($1::int[])
         ORDER BY updated_at DESC,id DESC
      `, [ids]);
    }

    const workByUser = new Map(ids.map((id) => [id, []]));
    for (const task of tasks) {
      const list = workByUser.get(Number(task.assigned_to_id));
      if (list && list.length < 6) list.push({
        type: "Task", id: Number(task.id), title: task.title, description: task.description || "",
        status: task.status || "Pending", priority: task.priority || "Medium",
        progress: null, due_date: task.due_date || null,
      });
    }
    for (const project of projects) {
      const list = workByUser.get(Number(project.assigned_employee_id));
      if (list && list.length < 6) list.push({
        type: "Project", id: Number(project.id), code: project.project_code, title: project.name,
        description: project.description || "", status: project.status || "Planned",
        priority: null, progress: Number(project.progress || 0), due_date: project.due_date || null,
        last_update: project.last_update || "",
      });
    }

    const level = Number(req.accessLevel || 6);
    const scope = isAdmin(req) ? "global" : level === 3 ? "department" : level === 4 ? "team" : "self";
    res.json({
      department: { key, name: department?.name || key, strategic_context: department?.strategic_context || "" },
      scope,
      level,
      employee_count: employees.length,
      employees: employees.map((employee) => ({
        ...employee,
        work_items: workByUser.get(Number(employee.id)) || [],
      })),
    });
  } catch (e) { next(e); }
});

module.exports = router;
