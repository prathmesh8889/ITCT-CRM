/** PDF-driven department services, project progress and restricted Intern workspace. */
const express = require("express");
const { db } = require("../db");
const { HttpError } = require("../core");
const { requireAuth, SUPER_ROLES } = require("../security");
const { scopedUserIds } = require("../workforce-scope");
const { DEPARTMENT_CATALOG, DEPARTMENT_BY_KEY } = require("../departments-catalog");
const { WORKFORCE_ROLES_BY_DEPARTMENT } = require("../workforce-roles");
const { departmentSpec, entitySpec, accessFor } = require("../department-workspace-spec");
const { ensureWorkforceDomainSchema } = require("../workforce-domain-schema");

const router = express.Router();
const clean = (v) => String(v ?? "").trim();
const admin = (req) => SUPER_ROLES.has(req.role?.name);
const clamp = (v) => Math.max(0, Math.min(100, Number(v) || 0));
const audit = (req, action, target, detail = "") => db.query(
  "INSERT INTO audit_logs (user_id,user_name,action,target,detail) VALUES ($1,$2,$3,$4,$5)",
  [req.user?.id ?? null, req.user?.name ?? "system", action, target, detail],
);

async function departmentKey(req, requested = "") {
  if (admin(req)) {
    const key = clean(requested) || DEPARTMENT_CATALOG[0].key;
    if (!DEPARTMENT_BY_KEY.has(key)) throw new HttpError(422, "Unknown Workforce OS department");
    return key;
  }
  const key = clean(req.role?.department_key);
  if (!DEPARTMENT_BY_KEY.has(key)) throw new HttpError(403, "Your role is not linked to an approved department");
  if (requested && requested !== key) throw new HttpError(403, "Cross-department workspace access is not allowed");
  return key;
}

function currentRole(req, key) {
  if (admin(req)) return { title: req.role.name, level: req.accessLevel, primary_function: "Global Workforce OS control." };
  return (WORKFORCE_ROLES_BY_DEPARTMENT.get(key) || []).find((r) => r.title === req.role.name)
    || { title: req.role.name, level: req.accessLevel, primary_function: "Department role" };
}

async function scopeIds(req) {
  const ids = await scopedUserIds(req);
  return ids === null ? null : (ids || []).map(Number).filter(Number.isInteger);
}

async function assertEmployee(req, key, userId, { project = false } = {}) {
  if (userId == null || userId === "") return null;
  const id = Number(userId);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(422, "Select a valid employee");
  const row = await db.one(`SELECT u.id,u.name,u.access_level,u.team_id,u.active,u.deleted_at,r.department_key,r.name role_name
    FROM users u LEFT JOIN roles r ON r.id=u.role_id WHERE u.id=$1`, [id]);
  if (!row || !row.active || row.deleted_at) throw new HttpError(422, "Selected employee is not active");
  if (row.department_key !== key) throw new HttpError(403, "Selected employee belongs to another department");
  if (project && Number(row.access_level) === 6) throw new HttpError(422, "Interns receive restricted micro-tasks, not production projects");
  if (!admin(req)) {
    const ids = await scopeIds(req);
    if (!ids?.includes(id)) throw new HttpError(403, "Selected employee is outside your Workforce OS scope");
  }
  return row;
}

function safeRecord(req, row, spec) {
  const out = { ...row, amount: row.amount == null ? null : Number(row.amount) };
  if (Number(req.accessLevel) !== 6) return out;
  if (spec?.credentials || spec?.production) {
    out.reference = "Restricted";
    out.description = "Restricted by Intern protocol";
    out.metadata = {};
  }
  if (spec?.financial) out.amount = null;
  if (spec?.pii && out.metadata && typeof out.metadata === "object") {
    const meta = { ...out.metadata };
    for (const k of Object.keys(meta)) if (/email|phone|mobile|whatsapp/i.test(k)) meta[k] = "Masked";
    out.metadata = meta;
  }
  return out;
}

async function recordRows(req, key, entityKey) {
  const spec = entitySpec(key, entityKey);
  if (!spec) throw new HttpError(404, "Department service not found");
  const access = accessFor(key, entityKey, req.accessLevel, admin(req));
  if (!access.actions.includes("read")) throw new HttpError(403, "This service is not available to your role");
  const params = [key, entityKey];
  const where = ["r.department_key=$1", "r.entity_key=$2"];
  if (!admin(req) && Number(req.accessLevel) === 4) {
    const ids = await scopeIds(req); params.push(ids || [req.user.id]);
    where.push("(r.shared OR r.assigned_user_id=ANY($3::int[]) OR r.created_by=ANY($3::int[]))");
  } else if (!admin(req) && Number(req.accessLevel) >= 5) {
    params.push(req.user.id); where.push("(r.shared OR r.assigned_user_id=$3 OR r.created_by=$3)");
  }
  const rows = await db.all(`SELECT r.*,u.name assigned_user_name,c.name created_by_name,a.name approved_by_name
    FROM workforce_domain_records r
    LEFT JOIN users u ON u.id=r.assigned_user_id
    LEFT JOIN users c ON c.id=r.created_by
    LEFT JOIN users a ON a.id=r.approved_by
    WHERE ${where.join(" AND ")} ORDER BY r.updated_at DESC,r.id DESC`, params);
  return { spec, access, rows: rows.map((r) => safeRecord(req, r, spec)) };
}

router.get("/workforce/workspace", requireAuth, async (req, res, next) => {
  try {
    await ensureWorkforceDomainSchema();
    const key = await departmentKey(req, req.query.department_key);
    const spec = departmentSpec(key);
    const entities = spec.entities.map((e) => ({ ...e, access_current: accessFor(key, e.key, req.accessLevel, admin(req)) }));

    const params = []; const where = [];
    if (!admin(req) && Number(req.accessLevel) === 3) {
      params.push(key); where.push("p.department_key=$1");
    } else if (!admin(req) && Number(req.accessLevel) === 4) {
      const ids = await scopeIds(req); params.push(ids || [req.user.id]);
      where.push("(p.project_manager_id=ANY($1::int[]) OR p.assigned_employee_id=ANY($1::int[]))");
    } else if (!admin(req)) {
      params.push(req.user.id); where.push("p.assigned_employee_id=$1");
    } else if (req.query.department_key) {
      params.push(key); where.push("p.department_key=$1");
    }
    const projects = await db.all(`SELECT p.*,pm.name project_manager_name,ae.name assigned_employee_name,ar.name assigned_employee_role,ae.access_level assigned_employee_level
      FROM workforce_projects p
      LEFT JOIN users pm ON pm.id=p.project_manager_id
      LEFT JOIN users ae ON ae.id=p.assigned_employee_id
      LEFT JOIN roles ar ON ar.id=ae.role_id
      ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY p.updated_at DESC,p.id DESC`, params);

    const assignable = (admin(req) || Number(req.accessLevel) <= 4) ? await db.all(`SELECT u.id,u.name,u.email,u.team_id,u.access_level,r.name role_name
      FROM users u JOIN roles r ON r.id=u.role_id
      WHERE u.active AND u.deleted_at IS NULL AND r.department_key=$1 ORDER BY u.access_level,u.name`, [key]) : [];

    let intern = null;
    if (Number(req.accessLevel) === 6) {
      const attendance = await db.one("SELECT * FROM workforce_intern_daily WHERE user_id=$1 AND work_date=CURRENT_DATE", [req.user.id]);
      const tasks = await db.all("SELECT id,title,description,priority,status,due_date FROM tasks WHERE assigned_to_id=$1 ORDER BY due_date NULLS LAST,id DESC LIMIT 20", [req.user.id]);
      intern = { attendance, tasks };
      await audit(req, "Intern Workspace Viewed", `department:${key}`, req.role.name);
    }

    res.json({
      department: { key: spec.key, name: spec.name, strategic_context: spec.strategic_context },
      role: currentRole(req, key), level: Number(req.accessLevel), entities,
      projects: projects.map((p) => ({ ...p, progress: Number(p.progress || 0) })), assignable_employees: assignable,
      available_departments: admin(req) ? DEPARTMENT_CATALOG.map((x) => ({ key: x.key, name: x.name })) : [{ key: spec.key, name: spec.name }],
      intern,
    });
  } catch (e) { next(e); }
});

router.get("/workforce/entities/:entityKey/records", requireAuth, async (req, res, next) => {
  try {
    await ensureWorkforceDomainSchema();
    const key = await departmentKey(req, req.query.department_key);
    const result = await recordRows(req, key, req.params.entityKey);
    if (Number(req.accessLevel) === 6) await audit(req, "Intern Service Viewed", `${key}:${req.params.entityKey}`);
    res.json(result);
  } catch (e) { next(e); }
});

router.post("/workforce/entities/:entityKey/records", requireAuth, async (req, res, next) => {
  try {
    await ensureWorkforceDomainSchema();
    const key = await departmentKey(req, req.body?.department_key || req.query.department_key);
    const spec = entitySpec(key, req.params.entityKey);
    if (!spec) throw new HttpError(404, "Department service not found");
    const access = accessFor(key, spec.key, req.accessLevel, admin(req));
    if (!access.actions.includes("create")) throw new HttpError(403, "Create is not allowed for this role");
    const title = clean(req.body?.title);
    if (!title) throw new HttpError(422, "Title is required");
    const assigned = await assertEmployee(req, key, req.body?.assigned_user_id);
    const amount = req.body?.amount === "" || req.body?.amount == null ? null : Number(req.body.amount);
    if (amount != null && !Number.isFinite(amount)) throw new HttpError(422, "Invalid amount");
    const row = await db.one(`INSERT INTO workforce_domain_records
      (department_key,entity_key,title,description,reference,status,amount,progress,due_date,shared,metadata,assigned_user_id,created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [key,spec.key,title,clean(req.body?.description),clean(req.body?.reference),clean(req.body?.status)||"Draft",amount,clamp(req.body?.progress),req.body?.due_date||null,!!spec.shared,req.body?.metadata||{},assigned?.id||null,req.user.id]);
    await audit(req, "Department Service Record Created", `${key}:${spec.key}:${row.id}`, title);
    res.status(201).json(safeRecord(req, row, spec));
  } catch (e) { next(e); }
});

router.patch("/workforce/records/:id", requireAuth, async (req, res, next) => {
  try {
    await ensureWorkforceDomainSchema();
    const row = await db.one("SELECT * FROM workforce_domain_records WHERE id=$1", [Number(req.params.id)]);
    if (!row) throw new HttpError(404, "Record not found");
    await departmentKey(req, row.department_key);
    const spec = entitySpec(row.department_key, row.entity_key);
    const access = accessFor(row.department_key, row.entity_key, req.accessLevel, admin(req));
    if (!access.actions.includes("edit")) throw new HttpError(403, "Edit is not allowed for this role");
    if (!admin(req) && Number(req.accessLevel) >= 5 && Number(row.created_by) !== Number(req.user.id) && Number(row.assigned_user_id) !== Number(req.user.id))
      throw new HttpError(403, "Record is outside your workspace");
    const assigned = req.body?.assigned_user_id === undefined ? undefined : await assertEmployee(req, row.department_key, req.body.assigned_user_id);
    const amount = req.body?.amount === undefined ? row.amount : (req.body.amount === "" || req.body.amount == null ? null : Number(req.body.amount));
    if (amount != null && !Number.isFinite(Number(amount))) throw new HttpError(422, "Invalid amount");
    const updated = await db.one(`UPDATE workforce_domain_records SET title=$1,description=$2,reference=$3,status=$4,amount=$5,progress=$6,due_date=$7,shared=$8,metadata=$9,assigned_user_id=$10,updated_at=now() WHERE id=$11 RETURNING *`,
      [req.body?.title!==undefined?clean(req.body.title):row.title,req.body?.description!==undefined?clean(req.body.description):row.description,req.body?.reference!==undefined?clean(req.body.reference):row.reference,req.body?.status!==undefined?clean(req.body.status):row.status,amount,req.body?.progress===undefined?row.progress:clamp(req.body.progress),req.body?.due_date===undefined?row.due_date:(req.body.due_date||null),spec?.shared?true:row.shared,req.body?.metadata===undefined?row.metadata:req.body.metadata,assigned===undefined?row.assigned_user_id:(assigned?.id||null),row.id]);
    await audit(req, "Department Service Record Updated", `${row.department_key}:${row.entity_key}:${row.id}`, updated.title);
    res.json(safeRecord(req, updated, spec));
  } catch (e) { next(e); }
});

router.post("/workforce/records/:id/approve", requireAuth, async (req, res, next) => {
  try {
    await ensureWorkforceDomainSchema();
    const row = await db.one("SELECT * FROM workforce_domain_records WHERE id=$1", [Number(req.params.id)]);
    if (!row) throw new HttpError(404, "Record not found");
    await departmentKey(req, row.department_key);
    if (!accessFor(row.department_key,row.entity_key,req.accessLevel,admin(req)).actions.includes("approve")) throw new HttpError(403, "Approval is not allowed for this role");
    const out = await db.one("UPDATE workforce_domain_records SET status='Approved',approved_by=$1,approved_at=now(),updated_at=now() WHERE id=$2 RETURNING *", [req.user.id,row.id]);
    await audit(req,"Department Service Record Approved",`record:${row.id}`,row.title); res.json(out);
  } catch (e) { next(e); }
});

router.post("/workforce/projects", requireAuth, async (req, res, next) => {
  try {
    await ensureWorkforceDomainSchema();
    if (!admin(req) && Number(req.accessLevel) > 4) throw new HttpError(403, "Only Department Heads and Team Leads can assign projects");
    const key = await departmentKey(req, req.body?.department_key);
    const name = clean(req.body?.name); if (!name) throw new HttpError(422, "Project name is required");
    const employee = await assertEmployee(req, key, req.body?.assigned_employee_id, { project: true });
    if (!employee) throw new HttpError(422, "Assigned employee is required");
    if (!admin(req) && Number(req.accessLevel) === 4 && Number(employee.access_level) !== 5) throw new HttpError(403, "Team Leads can assign projects only to full-time employees in their team");
    const code = `PRJ-${Date.now().toString(36).toUpperCase()}-${Math.floor(Math.random()*900+100)}`;
    const out = await db.one(`INSERT INTO workforce_projects(project_code,name,description,department_key,project_manager_id,assigned_employee_id,status,progress,start_date,due_date,last_update,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [code,name,clean(req.body?.description),key,req.user.id,employee.id,clean(req.body?.status)||"Planned",clamp(req.body?.progress),req.body?.start_date||null,req.body?.due_date||null,clean(req.body?.last_update),req.user.id]);
    await audit(req,"Project Assigned",`project:${out.id}`,`${employee.name}; ${key}`); res.status(201).json(out);
  } catch (e) { next(e); }
});

router.patch("/workforce/projects/:id", requireAuth, async (req, res, next) => {
  try {
    await ensureWorkforceDomainSchema();
    const row = await db.one("SELECT * FROM workforce_projects WHERE id=$1", [Number(req.params.id)]);
    if (!row) throw new HttpError(404, "Project not found");
    await departmentKey(req, row.department_key);
    const level = Number(req.accessLevel);
    if (!admin(req) && level === 6) throw new HttpError(403, "Intern project changes are blocked; use assigned micro-tasks");
    if (!admin(req) && level >= 5 && Number(row.assigned_employee_id) !== Number(req.user.id)) throw new HttpError(403, "Project is outside your workspace");
    if (!admin(req) && level === 4) {
      const ids = await scopeIds(req);
      if (!ids?.includes(Number(row.assigned_employee_id)) && Number(row.project_manager_id) !== Number(req.user.id)) throw new HttpError(403, "Project is outside your team");
    }
    const manager = admin(req) || level <= 4;
    const employee = manager && req.body?.assigned_employee_id !== undefined ? await assertEmployee(req,row.department_key,req.body.assigned_employee_id,{project:true}) : null;
    const out = await db.one(`UPDATE workforce_projects SET name=$1,description=$2,assigned_employee_id=$3,status=$4,progress=$5,start_date=$6,due_date=$7,last_update=$8,updated_at=now() WHERE id=$9 RETURNING *`,
      [manager&&req.body?.name!==undefined?clean(req.body.name):row.name,manager&&req.body?.description!==undefined?clean(req.body.description):row.description,employee?.id||row.assigned_employee_id,req.body?.status!==undefined?clean(req.body.status):row.status,req.body?.progress===undefined?row.progress:clamp(req.body.progress),manager&&req.body?.start_date!==undefined?(req.body.start_date||null):row.start_date,manager&&req.body?.due_date!==undefined?(req.body.due_date||null):row.due_date,req.body?.last_update!==undefined?clean(req.body.last_update):row.last_update,row.id]);
    await audit(req,"Project Progress Updated",`project:${row.id}`,`${out.progress}%`); res.json(out);
  } catch (e) { next(e); }
});

router.post("/workforce/intern/clock-in", requireAuth, async (req,res,next) => {
  try {
    await ensureWorkforceDomainSchema(); if (Number(req.accessLevel)!==6) throw new HttpError(403,"Intern workspace only");
    const out=await db.one(`INSERT INTO workforce_intern_daily(user_id,work_date,clock_in) VALUES($1,CURRENT_DATE,now()) ON CONFLICT(user_id,work_date) DO UPDATE SET clock_in=COALESCE(workforce_intern_daily.clock_in,EXCLUDED.clock_in) RETURNING *`,[req.user.id]);
    await audit(req,"Intern Clock In",`user:${req.user.id}`); res.json(out);
  } catch(e){next(e);}
});
router.post("/workforce/intern/daily-report", requireAuth, async (req,res,next) => {
  try {
    await ensureWorkforceDomainSchema(); if(Number(req.accessLevel)!==6) throw new HttpError(403,"Intern workspace only");
    const report=clean(req.body?.daily_report); if(!report) throw new HttpError(422,"Daily Work Report is required");
    const out=await db.one(`INSERT INTO workforce_intern_daily(user_id,work_date,daily_report,report_submitted_at) VALUES($1,CURRENT_DATE,$2,now()) ON CONFLICT(user_id,work_date) DO UPDATE SET daily_report=EXCLUDED.daily_report,report_submitted_at=now() RETURNING *`,[req.user.id,report]);
    await audit(req,"Intern Daily Work Report Submitted",`user:${req.user.id}`); res.json(out);
  } catch(e){next(e);}
});
router.post("/workforce/intern/clock-out", requireAuth, async (req,res,next) => {
  try {
    await ensureWorkforceDomainSchema(); if(Number(req.accessLevel)!==6) throw new HttpError(403,"Intern workspace only");
    const cur=await db.one("SELECT * FROM workforce_intern_daily WHERE user_id=$1 AND work_date=CURRENT_DATE",[req.user.id]);
    if(!cur?.clock_in) throw new HttpError(422,"Clock in first");
    if(!clean(cur.daily_report)) throw new HttpError(422,"Submit your Daily Work Report before clock-out");
    const out=await db.one("UPDATE workforce_intern_daily SET clock_out=COALESCE(clock_out,now()) WHERE user_id=$1 AND work_date=CURRENT_DATE RETURNING *",[req.user.id]);
    await audit(req,"Intern Clock Out",`user:${req.user.id}`); res.json(out);
  } catch(e){next(e);}
});

module.exports = router;
