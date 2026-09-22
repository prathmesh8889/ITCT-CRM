/** Department-isolated calendar feed + collision-safe meeting booking. */
const express = require("express");
const { db, pool } = require("../db");
const { HttpError } = require("../core");
const { requireAuth, requirePerm, SUPER_ROLES } = require("../security");
const { ensureOrganizationSchema } = require("../organization-schema");
const {
  googleCalendarConfigured,
  getGoogleBusyIntervals,
  isGoogleSlotBusy,
  createGoogleCalendarEvent,
  googleLocalEpoch,
} = require("../google-calendar");

const router = express.Router();
const isoDate = /^\d{4}-\d{2}-\d{2}$/;
const hhmm = /^([01]\d|2[0-3]):[0-5]\d$/;
const isAdmin = (req) => SUPER_ROLES.has(req.role?.name);

const minutes = (time) => {
  const [h, m] = String(time).split(":").map(Number);
  return h * 60 + m;
};
const fromMinutes = (value) => `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
const overlap = (aStart, aEnd, bStart, bEnd) => aStart < bEnd && aEnd > bStart;

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

router.get("/calendar/meetings", requireAuth, async (req, res, next) => {
  try {
    await ensureOrganizationSchema();
    const now = new Date();
    const from = String(req.query.from || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`);
    const to = String(req.query.to || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-31`);
    if (!isoDate.test(from) || !isoDate.test(to)) throw new HttpError(422, "from and to must be YYYY-MM-DD");

    const rows = await db.all(
      `SELECT id,title,date::text AS date,start_time,end_time,location,meeting_link,agenda,participants,
              google_event_id,google_sync_status,google_html_link,created_by,created_at
         FROM meetings
        WHERE date BETWEEN $1 AND $2
        ORDER BY date,start_time,title`,
      [from, to],
    );
    const visible = isAdmin(req)
      ? rows
      : rows.filter((m) => Array.isArray(m.participants) && m.participants.map(Number).includes(Number(req.user.id)));
    res.json(visible);
  } catch (e) { next(e); }
});

router.get("/calendar/availability", requireAuth, async (req, res, next) => {
  try {
    await ensureOrganizationSchema();
    const date = String(req.query.date || "");
    const slotMinutes = Math.min(120, Math.max(15, Number(req.query.slot_minutes || 30)));
    const dayStart = String(req.query.start || "09:00");
    const dayEnd = String(req.query.end || "18:00");
    if (!isoDate.test(date)) throw new HttpError(422, "date must be YYYY-MM-DD");
    if (!hhmm.test(dayStart) || !hhmm.test(dayEnd) || dayEnd <= dayStart) throw new HttpError(422, "invalid availability window");

    const localMeetings = await db.all(
      `SELECT start_time,end_time FROM meetings WHERE date=$1 ORDER BY start_time`,
      [date],
    );
    const companyEvents = await db.all(
      `SELECT start_time,end_time,all_day,kind FROM calendar_events WHERE event_date=$1`,
      [date],
    );

    let googleBusy = [];
    let googleError = "";
    if (googleCalendarConfigured()) {
      try {
        googleBusy = await getGoogleBusyIntervals(date, dayStart, dayEnd);
      } catch (e) {
        googleError = e.message || "Google Calendar availability check failed";
        console.error("[calendar] Google availability check failed:", googleError);
        throw new HttpError(503, "Calendar availability could not be verified. Please retry.");
      }
    }

    const slots = [];
    for (let startMin = minutes(dayStart); startMin + slotMinutes <= minutes(dayEnd); startMin += Math.min(30, slotMinutes)) {
      const endMin = startMin + slotMinutes;
      const start = fromMinutes(startMin);
      const end = fromMinutes(endMin);

      const crmBusy = localMeetings.some((m) => overlap(start, end, String(m.start_time || ""), String(m.end_time || "")));
      const eventBusy = companyEvents.some((e) =>
        Boolean(e.all_day) || e.kind === "holiday" || (
          hhmm.test(String(e.start_time || "")) &&
          hhmm.test(String(e.end_time || "")) &&
          overlap(start, end, String(e.start_time), String(e.end_time))
        )
      );
      const slotStartMs = googleLocalEpoch(date, start);
      const slotEndMs = googleLocalEpoch(date, end);
      const externalBusy = googleBusy.some((b) => overlap(
        slotStartMs,
        slotEndMs,
        new Date(b.start).getTime(),
        new Date(b.end).getTime(),
      ));

      slots.push({
        start,
        end,
        available: !(crmBusy || eventBusy || externalBusy),
        source: crmBusy ? "crm" : eventBusy ? "company_event" : externalBusy ? "google" : null,
      });
    }

    res.json({
      date,
      slot_minutes: slotMinutes,
      google_connected: googleCalendarConfigured(),
      google_error: googleError || null,
      slots,
    });
  } catch (e) { next(e); }
});

router.post("/calendar/meetings", requirePerm("meetings", "create"), async (req, res, next) => {
  let client;
  try {
    await ensureOrganizationSchema();
    const b = req.body || {};
    const title = String(b.title || "").trim();
    const date = String(b.date || "");
    const start = String(b.start_time || "");
    const end = String(b.end_time || "");
    if (!title || !isoDate.test(date)) throw new HttpError(422, "title and valid date are required");
    if (!hhmm.test(start) || !hhmm.test(end) || end <= start) throw new HttpError(422, "start_time and end_time must be valid and end after start");
    if (googleLocalEpoch(date, start) <= Date.now()) throw new HttpError(422, "Meeting slot must be in the future");

    const participants = [...new Set([
      Number(req.user.id),
      ...(Array.isArray(b.participants) ? b.participants.map(Number).filter(Number.isFinite) : []),
    ])];

    client = await pool.connect();
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`itct-calendar-${date}`]);

    const meetingConflict = await client.query(
      `SELECT id,title,start_time,end_time
         FROM meetings
        WHERE date=$1 AND start_time < $3 AND end_time > $2
        LIMIT 1`,
      [date, start, end],
    );
    if (meetingConflict.rowCount) {
      throw new HttpError(409, `This slot is already booked (${meetingConflict.rows[0].start_time}–${meetingConflict.rows[0].end_time})`);
    }

    const eventConflict = await client.query(
      `SELECT id,title,kind,start_time,end_time,all_day
         FROM calendar_events
        WHERE event_date=$1
          AND (all_day=TRUE OR kind='holiday' OR (start_time < $3 AND end_time > $2))
        LIMIT 1`,
      [date, start, end],
    );
    if (eventConflict.rowCount) {
      throw new HttpError(409, "This slot is blocked by a company calendar event");
    }

    if (googleCalendarConfigured()) {
      try {
        if (await isGoogleSlotBusy(date, start, end)) {
          throw new HttpError(409, "This slot is already busy in Google Calendar");
        }
      } catch (e) {
        if (e instanceof HttpError) throw e;
        console.error("[calendar] Google free/busy check failed; booking blocked:", e.message);
        throw new HttpError(503, "Calendar availability could not be verified. Please retry.");
      }
    }

    const syncStatus = googleCalendarConfigured() ? "pending" : "not_configured";
    const inserted = await client.query(
      `INSERT INTO meetings
        (title,lead_id,customer_id,participants,date,start_time,end_time,location,meeting_link,agenda,notes,outcome,
         google_sync_status,created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'',$9,'','',$10,$11)
       RETURNING *`,
      [
        title,
        b.lead_id ? Number(b.lead_id) : null,
        b.customer_id ? Number(b.customer_id) : null,
        JSON.stringify(participants),
        date,
        start,
        end,
        String(b.location || (b.create_google_meet === false ? "" : "Google Meet")).trim(),
        String(b.agenda || "").trim(),
        syncStatus,
        Number(req.user.id),
      ],
    );
    await client.query("COMMIT");
    client.release();
    client = null;

    let meeting = inserted.rows[0];
    let googleWarning = null;
    if (googleCalendarConfigured()) {
      try {
        const event = await createGoogleCalendarEvent({
          meetingId: meeting.id,
          title,
          date,
          start,
          end,
          location: meeting.location,
          agenda: meeting.agenda,
          createMeet: b.create_google_meet !== false,
        });
        const updated = await db.one(
          `UPDATE meetings
              SET google_event_id=$1,
                  google_html_link=$2,
                  meeting_link=CASE WHEN $3<>'' THEN $3 ELSE meeting_link END,
                  google_sync_status='synced'
            WHERE id=$4
          RETURNING *`,
          [event?.id || "", event?.htmlLink || "", event?.meetLink || "", meeting.id],
        );
        meeting = updated || meeting;
      } catch (e) {
        googleWarning = e.message || "Google Calendar sync failed";
        await db.query("UPDATE meetings SET google_sync_status='failed' WHERE id=$1", [meeting.id]);
        meeting.google_sync_status = "failed";
      }
    }

    res.status(201).json({
      ...meeting,
      date: String(meeting.date).slice(0, 10),
      google_connected: googleCalendarConfigured(),
      google_warning: googleWarning,
    });
  } catch (e) {
    if (client) {
      try { await client.query("ROLLBACK"); } catch { /* ignore rollback error */ }
      client.release();
    }
    next(e);
  }
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
