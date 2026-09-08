/** Departments, department-role policy, calendar event/holiday CRUD and self-profile editing. */
const express = require("express");
const { db } = require("../db");
const { HttpError } = require("../core");
const { requireAuth, requirePerm, SUPER_ROLES } = require("../security");
const { ensureOrganizationSchema } = require("../organization-schema");

const router = express.Router();
const audit = (user, action, target, detail = "") =>
  db.query(
    "INSERT INTO audit_logs (user_id, user_name, action, target, detail) VALUES ($1,$2,$3,$4,$5)",
    [user?.id ?? null, user?.name ?? "system", action, target, detail],
  );
const safeUser = (u) => { const { password_hash, ...rest } = u; return rest; };
const isoDate = /^\d{4}-\d{2}-\d{2}$/;
const clock = /^([01]\d|2[0-3]):[0-5]\d$/;

async function normalizedRoleIds(value) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new HttpError(422, "allowed_role_ids must be an array");
  const ids = [...new Set(value.map(Number).filter((x) => Number.isInteger(x) && x > 0))];
  if (ids.length !== value.length && value.length) throw new HttpError(422, "One or more role ids are invalid");
  if (ids.length) {
    const rows = await db.all("SELECT id FROM roles WHERE id = ANY($1::int[])", [ids]);
    if (rows.length !== ids.length) throw new HttpError(422, "One or more selected roles no longer exist");
  }
  return ids;
}

async function validateDepartmentAssignment(req, _res, next) {
  try {
    await ensureOrganizationSchema();
    const body = req.body || {};
    let current = null;
    if (req.method === "PATCH") {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return next();
      current = await db.one("SELECT department, role_id FROM users WHERE id = $1 AND deleted_at IS NULL", [id]);
      if (!current) return next();
    }

    const roleId = body.role_id !== undefined ? Number(body.role_id) : Number(current?.role_id || 0);
    const departmentName = String(body.department !== undefined ? body.department : (current?.department || "")).trim();
    if (!roleId || !departmentName) return next();

    const role = await db.one("SELECT id, name FROM roles WHERE id = $1", [roleId]);
    if (!role) throw new HttpError(422, "Selected role no longer exists");
    if (SUPER_ROLES.has(role.name)) return next();

    const department = await db.one(
      "SELECT * FROM departments WHERE lower(name) = lower($1)",
      [departmentName],
    );
    if (!department) throw new HttpError(422, "Select a valid department before assigning this role");
    if (!department.active) throw new HttpError(422, "The selected department is disabled");
    const allowed = Array.isArray(department.allowed_role_ids) ? department.allowed_role_ids.map(Number) : [];
    if (allowed.length && !allowed.includes(roleId))
      throw new HttpError(422, `${role.name} is not allowed in the ${department.name} department`);
    req.body.department = department.name;
    next();
  } catch (e) { next(e); }
}

// Validate department/role combinations before the existing employee create/update handlers run.
router.post("/users", requireAuth, validateDepartmentAssignment, (_req, _res, next) => next());
router.patch("/users/:id", requireAuth, validateDepartmentAssignment, (_req, _res, next) => next());

// AI Assistant has been removed from the CRM surface and API.
router.use("/ai", (_req, res) => res.status(404).json({ detail: "Not Found" }));

// ================= DEPARTMENTS =================
router.get("/departments", requirePerm("employees", "view"), async (_req, res, next) => {
  try {
    await ensureOrganizationSchema();
    const rows = await db.all(`
      SELECT d.*,
        (SELECT COUNT(*)::int FROM users u WHERE u.deleted_at IS NULL AND lower(trim(u.department)) = lower(trim(d.name))) AS member_count
      FROM departments d
      ORDER BY d.active DESC, d.name ASC
    `);
    res.json(rows);
  } catch (e) { next(e); }
});

router.post("/departments", requirePerm("employees", "create"), async (req, res, next) => {
  try {
    await ensureOrganizationSchema();
    const b = req.body || {};
    const name = String(b.name || "").trim();
    if (!name) throw new HttpError(422, "Department name is required");
    if (await db.one("SELECT id FROM departments WHERE lower(name) = lower($1)", [name]))
      throw new HttpError(409, "A department with this name already exists");
    const allowed = await normalizedRoleIds(b.allowed_role_ids ?? []);
    const r = await db.query(
      `INSERT INTO departments (name, description, allowed_role_ids, active)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [name, String(b.description || "").trim(), JSON.stringify(allowed), b.active !== false],
    );
    await audit(req.user, "Department Created", `department:${name}`, `${allowed.length} role restriction(s)`);
    res.status(201).json({ ...r.rows[0], member_count: 0 });
  } catch (e) { next(e); }
});

router.patch("/departments/:id", requirePerm("employees", "edit"), async (req, res, next) => {
  try {
    await ensureOrganizationSchema();
    const id = Number(req.params.id);
    const current = await db.one("SELECT * FROM departments WHERE id = $1", [id]);
    if (!current) throw new HttpError(404, "Department not found");
    const b = req.body || {};
    const name = b.name !== undefined ? String(b.name).trim() : current.name;
    if (!name) throw new HttpError(422, "Department name is required");
    const dupe = await db.one("SELECT id FROM departments WHERE lower(name) = lower($1) AND id <> $2", [name, id]);
    if (dupe) throw new HttpError(409, "A department with this name already exists");
    const allowed = b.allowed_role_ids !== undefined ? await normalizedRoleIds(b.allowed_role_ids) : current.allowed_role_ids;
    const description = b.description !== undefined ? String(b.description).trim() : current.description;
    const active = b.active !== undefined ? !!b.active : current.active;

    await db.tx(async (c) => {
      await c.query(
        `UPDATE departments SET name=$1, description=$2, allowed_role_ids=$3, active=$4, updated_at=now() WHERE id=$5`,
        [name, description, JSON.stringify(allowed || []), active, id],
      );
      if (name !== current.name) {
        await c.query(
          "UPDATE users SET department = $1 WHERE deleted_at IS NULL AND lower(trim(department)) = lower(trim($2))",
          [name, current.name],
        );
      }
    });
    await audit(req.user, "Department Updated", `department:${name}`, `${(allowed || []).length} allowed role(s)`);
    const row = await db.one(`
      SELECT d.*,
        (SELECT COUNT(*)::int FROM users u WHERE u.deleted_at IS NULL AND lower(trim(u.department)) = lower(trim(d.name))) AS member_count
      FROM departments d WHERE d.id = $1`, [id]);
    res.json(row);
  } catch (e) { next(e); }
});

router.delete("/departments/:id", requirePerm("employees", "delete"), async (req, res, next) => {
  try {
    await ensureOrganizationSchema();
    const id = Number(req.params.id);
    const current = await db.one("SELECT * FROM departments WHERE id = $1", [id]);
    if (!current) throw new HttpError(404, "Department not found");
    const members = await db.one(
      "SELECT COUNT(*)::int AS n FROM users WHERE deleted_at IS NULL AND lower(trim(department)) = lower(trim($1))",
      [current.name],
    );
    if (members?.n) throw new HttpError(409, "Move employees out of this department before deleting it");
    await db.query("DELETE FROM departments WHERE id = $1", [id]);
    await audit(req.user, "Department Deleted", `department:${current.name}`);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ================= SELF PROFILE =================
router.patch("/users/me/profile", requireAuth, async (req, res, next) => {
  try {
    const b = req.body || {};
    const name = b.name !== undefined ? String(b.name).trim() : req.user.name;
    const email = b.email !== undefined ? String(b.email).trim().toLowerCase() : req.user.email;
    const phone = b.phone !== undefined ? String(b.phone).trim() : req.user.phone;
    if (!name) throw new HttpError(422, "Name is required");
    if (!/^\S+@\S+\.\S+$/.test(email)) throw new HttpError(422, "Enter a valid email address");
    const dupe = await db.one("SELECT id FROM users WHERE lower(trim(email)) = $1 AND id <> $2 AND deleted_at IS NULL", [email, req.user.id]);
    if (dupe) throw new HttpError(409, "Email already exists");
    const r = await db.query(
      "UPDATE users SET name=$1, email=$2, phone=$3 WHERE id=$4 RETURNING *",
      [name, email, phone, req.user.id],
    );
    await audit(req.user, "Profile Updated", `user:${email}`);
    res.json(safeUser(r.rows[0]));
  } catch (e) { next(e); }
});

// ================= CALENDAR EVENTS / HOLIDAYS =================
router.get("/calendar/events", requirePerm("calendar", "view"), async (req, res, next) => {
  try {
    await ensureOrganizationSchema();
    const now = new Date();
    const from = String(req.query.from || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`);
    const to = String(req.query.to || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-31`);
    if (!isoDate.test(from) || !isoDate.test(to)) throw new HttpError(422, "from and to must be YYYY-MM-DD");
    const rows = await db.all(
      `SELECT id, title, kind, event_date::text AS date, start_time, end_time, all_day,
              location, description, created_by, created_at, updated_at
       FROM calendar_events WHERE event_date BETWEEN $1 AND $2
       ORDER BY event_date, all_day DESC, start_time, title`,
      [from, to],
    );
    res.json(rows);
  } catch (e) { next(e); }
});

function calendarPayload(body, current = {}) {
  const b = body || {};
  const title = b.title !== undefined ? String(b.title).trim() : current.title;
  const kind = b.kind !== undefined ? String(b.kind).toLowerCase() : (current.kind || "event");
  const date = b.date !== undefined ? String(b.date) : current.date;
  const startTime = b.start_time !== undefined ? String(b.start_time || "") : (current.start_time || "");
  const endTime = b.end_time !== undefined ? String(b.end_time || "") : (current.end_time || "");
  if (!title) throw new HttpError(422, "Title is required");
  if (!["event", "holiday"].includes(kind)) throw new HttpError(422, "kind must be event or holiday");
  if (!isoDate.test(String(date || ""))) throw new HttpError(422, "Date must be YYYY-MM-DD");
  if (startTime && !clock.test(startTime)) throw new HttpError(422, "Start time must be HH:MM");
  if (endTime && !clock.test(endTime)) throw new HttpError(422, "End time must be HH:MM");
  return {
    title,
    kind,
    date,
    start_time: kind === "holiday" ? "" : startTime,
    end_time: kind === "holiday" ? "" : endTime,
    all_day: kind === "holiday" ? true : (b.all_day !== undefined ? !!b.all_day : !!current.all_day),
    location: b.location !== undefined ? String(b.location || "").trim() : (current.location || ""),
    description: b.description !== undefined ? String(b.description || "").trim() : (current.description || ""),
  };
}

router.post("/calendar/events", requirePerm("calendar", "create"), async (req, res, next) => {
  try {
    await ensureOrganizationSchema();
    const p = calendarPayload(req.body);
    const r = await db.query(
      `INSERT INTO calendar_events (title, kind, event_date, start_time, end_time, all_day, location, description, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING id, title, kind, event_date::text AS date, start_time, end_time, all_day, location, description, created_by, created_at, updated_at`,
      [p.title, p.kind, p.date, p.start_time, p.end_time, p.all_day, p.location, p.description, req.user.id],
    );
    await audit(req.user, p.kind === "holiday" ? "Holiday Created" : "Calendar Event Created", `${p.kind}:${p.title}`, p.date);
    res.status(201).json(r.rows[0]);
  } catch (e) { next(e); }
});

router.patch("/calendar/events/:id", requirePerm("calendar", "edit"), async (req, res, next) => {
  try {
    await ensureOrganizationSchema();
    const id = Number(req.params.id);
    const current = await db.one(
      `SELECT id, title, kind, event_date::text AS date, start_time, end_time, all_day, location, description
       FROM calendar_events WHERE id = $1`, [id]);
    if (!current) throw new HttpError(404, "Calendar entry not found");
    const p = calendarPayload(req.body, current);
    const r = await db.query(
      `UPDATE calendar_events SET title=$1, kind=$2, event_date=$3, start_time=$4, end_time=$5,
         all_day=$6, location=$7, description=$8, updated_at=now() WHERE id=$9
       RETURNING id, title, kind, event_date::text AS date, start_time, end_time, all_day, location, description, created_by, created_at, updated_at`,
      [p.title, p.kind, p.date, p.start_time, p.end_time, p.all_day, p.location, p.description, id],
    );
    await audit(req.user, p.kind === "holiday" ? "Holiday Updated" : "Calendar Event Updated", `${p.kind}:${p.title}`, p.date);
    res.json(r.rows[0]);
  } catch (e) { next(e); }
});

router.delete("/calendar/events/:id", requirePerm("calendar", "delete"), async (req, res, next) => {
  try {
    await ensureOrganizationSchema();
    const id = Number(req.params.id);
    const current = await db.one("SELECT id, title, kind, event_date::text AS date FROM calendar_events WHERE id = $1", [id]);
    if (!current) throw new HttpError(404, "Calendar entry not found");
    await db.query("DELETE FROM calendar_events WHERE id = $1", [id]);
    await audit(req.user, current.kind === "holiday" ? "Holiday Deleted" : "Calendar Event Deleted", `${current.kind}:${current.title}`, current.date);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
