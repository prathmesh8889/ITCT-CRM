/** Department-isolated calendar feed for authenticated CRM users. */
const express = require("express");
const { db } = require("../db");
const { HttpError } = require("../core");
const { requireAuth, SUPER_ROLES } = require("../security");
const { ensureOrganizationSchema } = require("../organization-schema");

const router = express.Router();
const isoDate = /^\d{4}-\d{2}-\d{2}$/;
const isAdmin = (req) => SUPER_ROLES.has(req.role?.name);

router.get("/calendar/events", requireAuth, async (req, res, next) => {
  try {
    await ensureOrganizationSchema();
    const now = new Date();
    const from = String(req.query.from || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`);
    const to = String(req.query.to || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-31`);
    if (!isoDate.test(from) || !isoDate.test(to)) throw new HttpError(422, "from and to must be YYYY-MM-DD");

    const params = [from, to];
    let scopeSql = "";
    if (!isAdmin(req)) {
      const key = String(req.role?.department_key || "").trim();
      if (key) {
        params.push(key);
        scopeSql = `AND (r.department_key = $3 OR r.name IN ('Super Admin','Admin'))`;
      } else {
        params.push(Number(req.user.id));
        scopeSql = `AND (ce.created_by = $3 OR r.name IN ('Super Admin','Admin'))`;
      }
    }

    const rows = await db.all(
      `SELECT ce.id, ce.title, ce.kind, ce.event_date::text AS date, ce.start_time, ce.end_time, ce.all_day,
              ce.location, ce.description, ce.created_by, ce.created_at, ce.updated_at,
              u.name AS created_by_name, r.department_key AS creator_department_key
         FROM calendar_events ce
         LEFT JOIN users u ON u.id = ce.created_by
         LEFT JOIN roles r ON r.id = u.role_id
        WHERE ce.event_date BETWEEN $1 AND $2
          ${scopeSql}
        ORDER BY ce.event_date, ce.all_day DESC, ce.start_time, ce.title`,
      params,
    );
    res.json(rows);
  } catch (e) { next(e); }
});

async function assertEntryScope(req, eventId) {
  if (isAdmin(req)) return;
  const row = await db.one(`
    SELECT ce.id,ce.created_by,r.department_key,r.name AS creator_role
      FROM calendar_events ce
      LEFT JOIN users u ON u.id=ce.created_by
      LEFT JOIN roles r ON r.id=u.role_id
     WHERE ce.id=$1`, [eventId]);
  if (!row) throw new HttpError(404, "Calendar entry not found");
  const key = String(req.role?.department_key || "").trim();
  if (!key || row.department_key !== key) throw new HttpError(403, "This calendar entry belongs to another department");
}

// These guards run before the legacy calendar PATCH/DELETE handlers mounted later.
router.patch("/calendar/events/:id", requireAuth, async (req, _res, next) => {
  try { await assertEntryScope(req, Number(req.params.id)); next(); }
  catch (e) { next(e); }
});
router.delete("/calendar/events/:id", requireAuth, async (req, _res, next) => {
  try { await assertEntryScope(req, Number(req.params.id)); next(); }
  catch (e) { next(e); }
});

module.exports = router;
