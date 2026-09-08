/** Secure server-to-server lead intake for the official itcyber.in website. */
const express = require("express");
const crypto = require("crypto");
const { db } = require("../db");
const { HttpError, nextCode, normPhone, validateLead } = require("../core");
const { runTriggers } = require("../engines");

const router = express.Router();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_RE = /^[+\d][\d\s\-()]{7,17}$/;
let schemaReady = false;

function clean(value, max = 500) {
  if (value === null || value === undefined) return "";
  return String(value).replace(/\u0000/g, "").trim().slice(0, max);
}

function safeEqual(a, b) {
  const aa = Buffer.from(String(a || ""));
  const bb = Buffer.from(String(b || ""));
  return aa.length === bb.length && aa.length > 0 && crypto.timingSafeEqual(aa, bb);
}

async function ensureWebsiteIntakeSchema() {
  if (schemaReady) return;
  await db.query(`
    CREATE TABLE IF NOT EXISTS website_intake_events (
      id BIGSERIAL PRIMARY KEY,
      fingerprint TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await db.query("CREATE INDEX IF NOT EXISTS ix_website_intake_fp_time ON website_intake_events(fingerprint, created_at)");
  schemaReady = true;
}

async function consumeRateLimit(fingerprint) {
  await ensureWebsiteIntakeSchema();
  await db.query("DELETE FROM website_intake_events WHERE created_at < now() - interval '24 hours'");
  const perClient = await db.one(
    "SELECT COUNT(*)::int AS n FROM website_intake_events WHERE fingerprint = $1 AND created_at >= now() - interval '1 hour'",
    [fingerprint],
  );
  if ((perClient?.n || 0) >= 25) throw new HttpError(429, "Too many website submissions. Please try again later.");
  const global = await db.one(
    "SELECT COUNT(*)::int AS n FROM website_intake_events WHERE created_at >= now() - interval '1 hour'",
  );
  if ((global?.n || 0) >= 500) throw new HttpError(429, "Website lead intake is temporarily busy. Please try again later.");
  await db.query("INSERT INTO website_intake_events (fingerprint) VALUES ($1)", [fingerprint]);
}

function buildNotes(kind, payload, meta) {
  const lines = [kind === "assessment" ? "Website Automation Assessment" : "Website Project Brief"];
  const add = (label, value) => { const v = clean(value, 1800); if (v) lines.push(`${label}: ${v}`); };
  if (kind === "contact") {
    add("Message", payload.message);
    add("Company size", payload.company_size);
    add("Automation interest", payload.automation_interest);
    add("Existing tools", payload.existing_tools);
    add("Budget", payload.budget_range);
    add("Preferred contact", payload.preferred_contact);
  } else {
    add("Requirement", payload.requirement);
    add("Business problem", payload.business_problem);
    add("Existing tools", payload.existing_tools);
    add("Budget", payload.budget);
    add("Timeline", payload.timeline);
    if (payload.answers_json && typeof payload.answers_json === "object") {
      add("Assessment answers", JSON.stringify(payload.answers_json).slice(0, 1800));
    }
  }
  add("UTM source", meta.utm_source);
  add("UTM medium", meta.utm_medium);
  add("UTM campaign", meta.utm_campaign);
  return lines.join("\n").slice(0, 8000);
}

function sourceUrl(meta) {
  const page = clean(meta?.source_page, 180);
  if (/^https:\/\/([a-z0-9-]+\.)?itcyber\.in(\/|$)/i.test(page)) return page;
  return `https://itcyber.in${page.startsWith("/") ? page : "/contact"}`;
}

router.post("/integrations/itcyber/leads", async (req, res, next) => {
  try {
    const configuredSecret = process.env.ITCYBER_WEBSITE_WEBHOOK_SECRET || "";
    if (!configuredSecret) throw new HttpError(503, "Website CRM integration is not configured");
    if (!safeEqual(req.get("x-itcyber-webhook-secret"), configuredSecret))
      throw new HttpError(401, "Invalid website integration credentials");

    const body = req.body || {};
    const kind = clean(body.kind, 20).toLowerCase();
    if (!["contact", "assessment"].includes(kind)) throw new HttpError(422, "Unsupported website submission type");
    const payload = body.payload && typeof body.payload === "object" && !Array.isArray(body.payload) ? body.payload : {};
    const meta = body.meta && typeof body.meta === "object" && !Array.isArray(body.meta) ? body.meta : {};
    if (JSON.stringify(body).length > 40_000) throw new HttpError(413, "Website submission is too large");

    const fullName = clean(payload.full_name, 120);
    const company = clean(payload.company, 160);
    const email = clean(payload.email, 254).toLowerCase();
    const phone = clean(payload.phone, 30);
    const website = clean(payload.website, 250);
    const industry = clean(payload.industry, 80);
    if (!fullName) throw new HttpError(422, "Full name is required");
    if (!email || !EMAIL_RE.test(email)) throw new HttpError(422, "A valid email is required");
    if (phone && !PHONE_RE.test(phone)) throw new HttpError(422, "Phone number looks invalid");
    if (kind === "contact" && !clean(payload.message, 4000)) throw new HttpError(422, "Project description is required");

    const suppliedFingerprint = clean(req.get("x-itcyber-fingerprint"), 128);
    const fallbackFingerprint = crypto.createHash("sha256")
      .update(`${req.ip}|${req.get("user-agent") || "unknown"}`)
      .digest("hex");
    await consumeRateLimit(suppliedFingerprint || fallbackFingerprint);

    const phoneNorm = normPhone(phone);
    const duplicate = await db.one(
      `SELECT * FROM leads
       WHERE deleted_at IS NULL
         AND status NOT IN ('Won','Lost','Converted')
         AND (
           ($1 <> '' AND lower(trim(COALESCE(email,''))) = lower($1))
           OR ($2 <> '' AND right(regexp_replace(COALESCE(phone,''), '[^0-9]', '', 'g'), 10) = $2)
         )
       ORDER BY created_at DESC
       LIMIT 1`,
      [email, phoneNorm],
    );

    const srcUrl = sourceUrl(meta);
    const notes = buildNotes(kind, payload, meta);
    const businessName = company || fullName;
    const category = kind === "assessment"
      ? clean(payload.requirement, 80) || "Website Assessment"
      : clean(payload.automation_interest, 80) || "Website Enquiry";

    if (duplicate) {
      const stamp = new Date().toISOString();
      const appended = `${duplicate.notes || ""}${duplicate.notes ? "\n\n" : ""}[${stamp}] ${notes}`.slice(-12000);
      await db.query(
        `UPDATE leads SET
          contact_person = CASE WHEN trim(COALESCE(contact_person,'')) = '' THEN $1 ELSE contact_person END,
          company_name = CASE WHEN trim(COALESCE(company_name,'')) = '' THEN $2 ELSE company_name END,
          phone = CASE WHEN trim(COALESCE(phone,'')) = '' THEN $3 ELSE phone END,
          website = CASE WHEN trim(COALESCE(website,'')) = '' THEN $4 ELSE website END,
          industry = CASE WHEN trim(COALESCE(industry,'')) = '' THEN $5 ELSE industry END,
          category = CASE WHEN trim(COALESCE(category,'')) = '' THEN $6 ELSE category END,
          source_url = CASE WHEN trim(COALESCE(source_url,'')) = '' THEN $7 ELSE source_url END,
          notes = $8,
          updated_at = now()
         WHERE id = $9`,
        [fullName, company, phone, website, industry, category, srcUrl, appended, duplicate.id],
      );
      await db.query(
        "INSERT INTO audit_logs (user_id, user_name, action, target, detail) VALUES (NULL,'ITCYBER Website','Website Lead Matched',$1,$2)",
        [`lead:${duplicate.id}`, `${email} matched existing lead`],
      );
      return res.json({ ok: true, duplicate: true, lead_id: duplicate.id, lead_code: duplicate.lead_code });
    }

    const nameParts = fullName.split(/\s+/).filter(Boolean);
    const firstName = nameParts.shift() || fullName;
    const lastName = nameParts.join(" ");
    const leadData = { email, phone, website, business_name: businessName };
    const validation = validateLead(leadData);
    const code = await nextCode(db, "leads", "lead_code", "LD");

    const inserted = await db.query(
      `INSERT INTO leads (
        lead_code, business_name, first_name, last_name, company_name, contact_person,
        email, phone, website, industry, category, source, source_url,
        status, priority, estimated_value, validation, notes, created_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'Website',$12,'New',$13,0,$14,$15,NULL)
       RETURNING *`,
      [
        code, businessName, firstName, lastName, company, fullName,
        email, phone, website, industry, category, srcUrl,
        kind === "assessment" ? "High" : "Medium", validation, notes,
      ],
    );
    const lead = inserted.rows[0];
    await db.query(
      "INSERT INTO lead_scores (lead_id, score, temperature, intent, action, reason, scored_by) VALUES ($1,0,'Cold','Low','','Website enquiry awaiting qualification','website')",
      [lead.id],
    );
    await db.query(
      "INSERT INTO audit_logs (user_id, user_name, action, target, detail) VALUES (NULL,'ITCYBER Website','Website Lead Created',$1,$2)",
      [`lead:${lead.id}`, `${fullName} · ${email}`],
    );
    try { await runTriggers("lead.created", { lead }); }
    catch (triggerError) { console.error("[website-leads] lead.created trigger failed:", triggerError.message); }

    res.status(201).json({ ok: true, duplicate: false, lead_id: lead.id, lead_code: lead.lead_code });
  } catch (e) { next(e); }
});

module.exports = router;
