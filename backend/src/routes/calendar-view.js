/** Shared read-only calendar feed for every authenticated CRM user. */
const express = require("express");
const { db } = require("../db");
const { HttpError } = require("../core");
const { requireAuth } = require("../security");
const { ensureOrganizationSchema } = require("../organization-schema");

const router = express.Router();
const isoDate = /^\d{4}-\d{2}-\d{2}$/;

router.get("/calendar/events", requireAuth, async (req, res, next) => {
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

module.exports = router;
