/** Scoped department roster, assignment endpoints and live work/activity overview. */
const express = require("express");
const { db } = require("../db");
const { HttpError } = require("../core");
const { requireAuth, SUPER_ROLES } = require("../security");
const { scopedUserIds } = require("../workforce-scope");
const { DEPARTMENT_CATALOG, DEPARTMENT_BY_KEY } = require("../departments-catalog");
const { ensureWorkforceDomainSchema } = require("../workforce-domain-schema");
const { ensureOrganizationSchema } = require("../organization-schema");

const router = express.Router();
const clean = (v) => String(v || "").trim();
const isAdmin = (req) => SUPER_ROLES.has(req.role?.name);
const isoDate = /^\d{4}-\d{2}-\d{2}$/;
const clock = /^([01]\d|2[0-3]):[0-5]\d$/;

const audit = (req, action, target, detail = "") => db.query(
  "INSERT INTO audit_logs (user_id,user_name,action,target,detail) VALUES ($1,$2,$3,$4,$5)",
  [req.user?.id ?? null, req.user?.name ?? "system", action, target, detail],
);

async function resolveDepartmentKey(req) {
  if (isAdmin(req)) {
    const requested = clean(req.query.department_key || req.body?.department_key);
    const key = requested || DEPARTMENT_CATALOG[0]?.key;
    if (!key || !DEPARTMENT_BY_KEY.has(key)) throw new HttpError(422, "Unknown Workforce OS department");
    return key;
  }
  const key = clean(req.role?.department_key);
  if (!key || !DEPARTMENT_BY_KEY.has(key)) throw new HttpError(403, "Your role is not linked to an approved department");
  const requested = clean(req.query.department_key || req.body?.department_key);
  if (requested && requested !== key) throw new HttpError(403, "Cross-department access is not allowed");
  return key;
}

async function visibleIds(req) {
  const ids = await scopedUserIds(req);
  return ids === null ? null : (ids || []).map(Number).filter(Number.isInteger);
}

function assertManager(req) {
  if (isAdmin(req)) return;
  if (Number(req.accessLevel) > 4) throw new HttpError(403, "Only Department Heads and Team Leads can assign department work");
}

async function scopedEmployee(req, key, userId) {
  const id = Number(userId);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(422, "Select a valid employee");
  const employee = await db.one(`
    SELECT u.id,u.name,u.email,u.active,u.deleted_at,u.access_level,u.team_id,r.department_key,r.name AS role_name
      FROM users u JOIN roles r ON r.id=u.role_id
     WHERE u.id=$1`, [id]);
  if (!employee || !employee.active || employee.deleted_at) throw new HttpError(422, "Selected employee is inactive or unavailable");
  if (employee.department_key !== key) throw new HttpError(403, "Selected employee belongs to another department");
  if (!isAdmin(req)) {
    const ids = await visibleIds(req);
    if (!ids?.includes(id)) throw new HttpError(403, "Selected employee is outside your Workforce OS scope");
  }
  return employee;
}

function pushLimited(map, userId, item) {
  const list = map.get(Number(userId));
  if (list && list.length < 8) list.push(item);
}

router.get("/workforce/department-overview", requireAuth, async (req, res, next) => {
  try {
    await ensureWorkforceDomainSchema();
    await ensureOrganizationSchema();
    const key = await resolveDepartmentKey(req);
    const department = DEPARTMENT_BY_KEY.get(key);

    const where = ["u.deleted_at IS NULL", "u.active = TRUE", "r.department_key = $1"];
    const params = [key];
    if (!isAdmin(req)) {
      const ids = (await visibleIds(req)) || [];
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
    const workByUser = new Map(ids.map((id) => [id, []]));
    const departmentActivity = [];
    const employeeName = new Map(employees.map((x) => [Number(x.id), x.name]));

    let tasks = [], projects = [], meetings = [], followups = [];
    if (ids.length) {
      [tasks, projects, meetings, followups] = await Promise.all([
        db.all(`SELECT id,title,description,priority,status,due_date,assigned_to_id,created_by_id,created_at
                  FROM tasks WHERE assigned_to_id = ANY($1::int[])
                 ORDER BY created_at DESC,id DESC LIMIT 200`, [ids]),
        db.all(`SELECT id,project_code,name,description,status,progress,due_date,last_update,assigned_employee_id,created_by,created_at
                  FROM workforce_projects WHERE assigned_employee_id = ANY($1::int[])
                 ORDER BY updated_at DESC,id DESC LIMIT 200`, [ids]),
        db.all(`SELECT id,title,agenda,date,start_time,end_time,location,participants,created_at
                  FROM meetings
                 WHERE EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(participants,'[]'::jsonb)) p(v)
                                WHERE p.v = ANY($1::text[]))
                 ORDER BY date DESC,start_time DESC,id DESC LIMIT 120`, [ids.map(String)]),
        db.all(`SELECT id,type,date,time,status,notes,outcome,employee_id,created_at
                  FROM followups WHERE employee_id = ANY($1::int[])
                 ORDER BY date DESC,time DESC,id DESC LIMIT 120`, [ids]),
      ]);
    }

    for (const task of tasks) {
      const item = {
        type: "Task", id: Number(task.id), title: task.title, description: task.description || "",
        status: task.status || "Pending", priority: task.priority || "Medium", progress: null,
        due_date: task.due_date || null, created_at: task.created_at,
      };
      pushLimited(workByUser, task.assigned_to_id, item);
      departmentActivity.push({ ...item, assigned_user_id: Number(task.assigned_to_id), assigned_user_name: employeeName.get(Number(task.assigned_to_id)) || "" });
    }

    for (const project of projects) {
      const item = {
        type: "Project", id: Number(project.id), code: project.project_code, title: project.name,
        description: project.description || "", status: project.status || "Planned", priority: null,
        progress: Number(project.progress || 0), due_date: project.due_date || null,
        last_update: project.last_update || "", created_at: project.created_at,
      };
      pushLimited(workByUser, project.assigned_employee_id, item);
      departmentActivity.push({ ...item, assigned_user_id: Number(project.assigned_employee_id), assigned_user_name: employeeName.get(Number(project.assigned_employee_id)) || "" });
    }

    for (const meeting of meetings) {
      const participantIds = Array.isArray(meeting.participants) ? meeting.participants.map(Number).filter(Number.isInteger) : [];
      const item = {
        type: "Meeting", id: Number(meeting.id), title: meeting.title, description: meeting.agenda || "",
        status: "Scheduled", priority: null, progress: null, due_date: meeting.date || null,
        time: meeting.start_time || "", location: meeting.location || "", created_at: meeting.created_at,
      };
      for (const id of participantIds) if (workByUser.has(id)) pushLimited(workByUser, id, item);
      departmentActivity.push({ ...item, participant_names: participantIds.map((id) => employeeName.get(id)).filter(Boolean) });
    }

    for (const followup of followups) {
      const item = {
        type: "Follow-up", id: Number(followup.id), title: `${followup.type || "Follow-up"} follow-up`,
        description: followup.notes || followup.outcome || "", status: followup.status || "Scheduled",
        priority: null, progress: null, due_date: followup.date || null, time: followup.time || "", created_at: followup.created_at,
      };
      pushLimited(workByUser, followup.employee_id, item);
      departmentActivity.push({ ...item, assigned_user_id: Number(followup.employee_id), assigned_user_name: employeeName.get(Number(followup.employee_id)) || "" });
    }

    // Calendar events are department-scoped by the creator's approved Workforce role.
    // Super Admin/Admin-created entries are company-wide and therefore visible to every department.
    const events = await db.all(`
      SELECT ce.id,ce.title,ce.kind,ce.event_date::text AS date,ce.start_time,ce.end_time,
             ce.all_day,ce.location,ce.description,ce.created_at,u.name AS created_by_name,r.name AS creator_role
        FROM calendar_events ce
        LEFT JOIN users u ON u.id=ce.created_by
        LEFT JOIN roles r ON r.id=u.role_id
       WHERE (r.department_key=$1 OR r.name IN ('Super Admin','Admin'))
         AND ce.event_date >= CURRENT_DATE - INTERVAL '30 days'
         AND ce.event_date <= CURRENT_DATE + INTERVAL '180 days'
       ORDER BY ce.event_date DESC,ce.start_time DESC,ce.id DESC
       LIMIT 120`, [key]);
    for (const event of events) departmentActivity.push({
      type: event.kind === "holiday" ? "Holiday" : "Event", id: Number(event.id), title: event.title,
      description: event.description || "", status: event.kind === "holiday" ? "Holiday" : "Scheduled",
      due_date: event.date, time: event.start_time || "", location: event.location || "",
      created_by_name: event.created_by_name || "", created_at: event.created_at,
    });

    const serviceRecords = await db.all(`
      SELECT r.id,r.title,r.description,r.status,r.progress,r.due_date,r.assigned_user_id,r.created_at,
             u.name AS assigned_user_name
        FROM workforce_domain_records r
        LEFT JOIN users u ON u.id=r.assigned_user_id
       WHERE r.department_key=$1
       ORDER BY r.updated_at DESC,r.id DESC LIMIT 80`, [key]);
    for (const record of serviceRecords) departmentActivity.push({
      type: "Service Record", id: Number(record.id), title: record.title, description: record.description || "",
      status: record.status || "Draft", progress: Number(record.progress || 0), due_date: record.due_date || null,
      assigned_user_id: record.assigned_user_id ? Number(record.assigned_user_id) : null,
      assigned_user_name: record.assigned_user_name || "", created_at: record.created_at,
    });

    const sortTime = (x) => {
      const raw = x.created_at || x.due_date || "";
      const t = raw ? new Date(raw).getTime() : 0;
      return Number.isFinite(t) ? t : 0;
    };
    departmentActivity.sort((a, b) => sortTime(b) - sortTime(a));

    const level = Number(req.accessLevel || 6);
    const scope = isAdmin(req) ? "global" : level === 3 ? "department" : level === 4 ? "team" : "self";
    res.json({
      department: { key, name: department?.name || key, strategic_context: department?.strategic_context || "" },
      scope,
      level,
      can_manage: isAdmin(req) || level <= 4,
      employee_count: employees.length,
      employees: employees.map((employee) => ({ ...employee, work_items: workByUser.get(Number(employee.id)) || [] })),
      activity: departmentActivity.slice(0, 40),
    });
  } catch (e) { next(e); }
});

router.post("/workforce/department-tasks", requireAuth, async (req, res, next) => {
  try {
    assertManager(req);
    const key = await resolveDepartmentKey(req);
    const title = clean(req.body?.title);
    if (!title) throw new HttpError(422, "Task title is required");
    const employee = await scopedEmployee(req, key, req.body?.assigned_user_id);
    const priority = clean(req.body?.priority) || "Medium";
    if (!["Low", "Medium", "High", "Urgent"].includes(priority)) throw new HttpError(422, "Invalid task priority");
    const dueDate = req.body?.due_date ? clean(req.body.due_date) : null;
    if (dueDate && !isoDate.test(dueDate)) throw new HttpError(422, "Due date must be YYYY-MM-DD");
    const row = await db.one(`
      INSERT INTO tasks (title,description,assigned_to_id,created_by_id,priority,status,due_date)
      VALUES ($1,$2,$3,$4,$5,'Pending',$6)
      RETURNING id,title,description,assigned_to_id,created_by_id,priority,status,due_date,created_at`,
      [title, clean(req.body?.description), employee.id, req.user.id, priority, dueDate]);
    await audit(req, "Department Task Assigned", `task:${row.id}`, `${employee.name} · ${title}`);
    res.status(201).json({ ...row, assigned_user_name: employee.name, department_key: key });
  } catch (e) { next(e); }
});

router.post("/workforce/department-events", requireAuth, async (req, res, next) => {
  try {
    assertManager(req);
    const key = await resolveDepartmentKey(req);
    await ensureOrganizationSchema();
    const title = clean(req.body?.title);
    const date = clean(req.body?.date);
    const kind = clean(req.body?.kind || "event").toLowerCase();
    const start = clean(req.body?.start_time);
    const end = clean(req.body?.end_time);
    if (!title) throw new HttpError(422, "Event title is required");
    if (!isoDate.test(date)) throw new HttpError(422, "Event date must be YYYY-MM-DD");
    if (!["event", "holiday"].includes(kind)) throw new HttpError(422, "kind must be event or holiday");
    if (start && !clock.test(start)) throw new HttpError(422, "Start time must be HH:MM");
    if (end && !clock.test(end)) throw new HttpError(422, "End time must be HH:MM");
    const row = await db.one(`
      INSERT INTO calendar_events (title,kind,event_date,start_time,end_time,all_day,location,description,created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      RETURNING id,title,kind,event_date::text AS date,start_time,end_time,all_day,location,description,created_by,created_at`,
      [title, kind, date, kind === "holiday" ? "" : start, kind === "holiday" ? "" : end,
       kind === "holiday" ? true : !!req.body?.all_day, clean(req.body?.location), clean(req.body?.description), req.user.id]);
    await audit(req, kind === "holiday" ? "Department Holiday Created" : "Department Event Created", `${kind}:${row.id}`, `${key} · ${date}`);
    res.status(201).json({ ...row, department_key: key });
  } catch (e) { next(e); }
});

// Prevent department managers from adding meeting participants outside their allowed scope.
router.post("/meetings", requireAuth, async (req, _res, next) => {
  try {
    if (!Array.isArray(req.body?.participants)) return next();
    const ids = await visibleIds(req);
    if (ids === null) return next();
    const participants = req.body.participants.map(Number).filter(Number.isInteger);
    if (participants.some((id) => !ids.includes(id))) throw new HttpError(403, "One or more meeting participants are outside your Workforce OS scope");
    next();
  } catch (e) { next(e); }
});

module.exports = router;
