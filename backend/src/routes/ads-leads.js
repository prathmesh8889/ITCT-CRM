/**
 * Secure ad-lead ingestion.
 *
 * Public endpoints:
 *   GET/POST /integrations/ads/meta          Meta Lead Ads verification + signed webhook
 *   POST     /integrations/ads/ingest/:provider
 *            Server-to-server bridge for website forms / TikTok / other ad platforms.
 *
 * Protected endpoints:
 *   GET      /ads-leads
 *   GET      /ads-leads/status
 *   POST     /ads-leads/:id/retry
 *
 * Secrets are environment variables only and are never returned by the API.
 */
const express = require("express");
const crypto = require("crypto");
const { db } = require("../db");
const { config, HttpError, nextCode, normPhone, validateLead, sha256 } = require("../core");
const { requirePerm } = require("../security");

const router = express.Router();
const PUBLIC_PROVIDERS = new Set(["website", "tiktok", "meta", "facebook", "instagram", "google", "other"]);
const rateBuckets = new Map();
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 120;

const clip = (value, max = 500) => String(value ?? "").trim().slice(0, max);
const boolOrNull = (v) => v === true || v === "true" || v === 1 || v === "1" ? true
  : v === false || v === "false" || v === 0 || v === "0" ? false : null;

function safeEqual(a, b) {
  const aa = Buffer.from(String(a || ""));
  const bb = Buffer.from(String(b || ""));
  return aa.length === bb.length && aa.length > 0 && crypto.timingSafeEqual(aa, bb);
}

function publicRateLimit(req, _res, next) {
  const now = Date.now();
  const key = `${req.ip || "unknown"}|${req.path}`;
  const current = rateBuckets.get(key);
  if (!current || now - current.at >= RATE_WINDOW_MS) {
    rateBuckets.set(key, { at: now, n: 1 });
  } else {
    current.n += 1;
    if (current.n > RATE_MAX) return next(new HttpError(429, "Too many webhook requests"));
  }
  if (rateBuckets.size > 2000) {
    for (const [k, v] of rateBuckets) if (now - v.at > RATE_WINDOW_MS * 2) rateBuckets.delete(k);
  }
  next();
}

function providerLabel(provider) {
  const p = String(provider || "").toLowerCase();
  if (p === "meta" || p === "facebook" || p === "instagram") return "Meta Ads";
  if (p === "tiktok") return "TikTok Ads";
  if (p === "google") return "Google Ads";
  if (p === "website") return "Website Ads";
  return "Ad Campaign";
}

function pick(obj, ...keys) {
  for (const key of keys) {
    const value = obj?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") return value;
  }
  return "";
}

function filteredExtras(input) {
  const blocked = /(password|passwd|secret|token|authorization|cookie|card|cvv|aadhaar|aadhar|pan_number|otp|email|phone|mobile|whatsapp|full_name|first_name|last_name)/i;
  const out = {};
  for (const [key, value] of Object.entries(input || {})) {
    if (blocked.test(key)) continue;
    if (value === undefined || value === null) continue;
    if (typeof value === "object") continue;
    out[clip(key, 80)] = clip(value, 1000);
    if (Object.keys(out).length >= 30) break;
  }
  return out;
}

function normalizeGeneric(provider, body = {}) {
  const firstName = clip(pick(body, "first_name", "firstName"), 120);
  const lastName = clip(pick(body, "last_name", "lastName"), 120);
  const fullName = clip(pick(body, "full_name", "fullName", "name", "contact_person"), 240)
    || clip(`${firstName} ${lastName}`.trim(), 240);
  const email = clip(pick(body, "email", "email_address"), 240).toLowerCase();
  const phone = clip(pick(body, "phone", "phone_number", "mobile", "mobile_number"), 80);
  const campaignId = clip(pick(body, "campaign_id", "campaignId"), 160);
  const adId = clip(pick(body, "ad_id", "adId"), 160);
  const formId = clip(pick(body, "form_id", "formId"), 160);
  const businessName = clip(pick(body, "business_name", "businessName", "company", "company_name"), 240);
  const sourceUrl = clip(pick(body, "source_url", "sourceUrl", "landing_page", "landingPage", "page_url"), 1000);
  const submittedAt = clip(pick(body, "submitted_at", "submittedAt", "created_time", "created_at"), 100);
  const suppliedExternal = clip(pick(body, "external_id", "externalId", "lead_id", "leadId", "id"), 220);
  const fallbackIdentity = [provider, email, normPhone(phone), campaignId, adId, formId, sourceUrl, submittedAt]
    .join("|");
  const externalId = suppliedExternal || sha256(fallbackIdentity || JSON.stringify(body)).slice(0, 48);

  return {
    provider: clip(provider, 40).toLowerCase(),
    external_id: externalId,
    platform: clip(pick(body, "platform", "channel", "network") || provider, 80),
    campaign_id: campaignId,
    campaign_name: clip(pick(body, "campaign_name", "campaignName"), 300),
    ad_id: adId,
    ad_name: clip(pick(body, "ad_name", "adName", "creative_name"), 300),
    form_id: formId,
    form_name: clip(pick(body, "form_name", "formName"), 300),
    full_name: fullName,
    first_name: firstName || clip(fullName.split(/\s+/)[0] || "", 120),
    last_name: lastName || clip(fullName.split(/\s+/).slice(1).join(" "), 120),
    email,
    phone,
    whatsapp: clip(pick(body, "whatsapp", "whatsapp_number"), 80) || phone,
    business_name: businessName,
    city: clip(pick(body, "city"), 160),
    state: clip(pick(body, "state", "region"), 160),
    service_interest: clip(pick(body, "service_interest", "service", "service_name", "interested_in"), 300),
    source_url: sourceUrl,
    utm_source: clip(pick(body, "utm_source"), 160),
    utm_medium: clip(pick(body, "utm_medium"), 160),
    utm_campaign: clip(pick(body, "utm_campaign"), 300),
    utm_content: clip(pick(body, "utm_content"), 300),
    utm_term: clip(pick(body, "utm_term"), 300),
    consent: boolOrNull(pick(body, "consent", "privacy_consent", "marketing_consent")),
    extra_fields: filteredExtras(body.extra || body.custom_fields || {}),
  };
}

function normalizeMetaFields(record, notification = {}) {
  const fieldMap = {};
  for (const item of record?.field_data || []) {
    const key = String(item?.name || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
    const value = Array.isArray(item?.values) ? item.values[0] : "";
    if (key) fieldMap[key] = value ?? "";
  }
  const generic = normalizeGeneric("meta", {
    external_id: record?.id || notification.leadgen_id,
    platform: "Meta (Facebook / Instagram)",
    campaign_id: record?.campaign_id || notification.campaign_id,
    campaign_name: record?.campaign_name || "",
    ad_id: record?.ad_id || notification.ad_id,
    ad_name: record?.ad_name || "",
    form_id: record?.form_id || notification.form_id,
    form_name: record?.form_name || "",
    submitted_at: record?.created_time || "",
    full_name: pick(fieldMap, "full_name", "name"),
    first_name: pick(fieldMap, "first_name"),
    last_name: pick(fieldMap, "last_name"),
    email: pick(fieldMap, "email"),
    phone: pick(fieldMap, "phone_number", "phone", "mobile_number", "mobile"),
    whatsapp: pick(fieldMap, "whatsapp", "whatsapp_number"),
    business_name: pick(fieldMap, "company_name", "company", "business_name"),
    city: pick(fieldMap, "city"),
    state: pick(fieldMap, "state", "region"),
    service_interest: pick(fieldMap, "service_interest", "service", "interested_in", "service_name"),
    extra: fieldMap,
  });
  generic.extra_fields = filteredExtras(fieldMap);
  return generic;
}

async function upsertEvent(p) {
  const r = await db.query(`
    INSERT INTO ad_lead_events (
      provider,external_id,platform,campaign_id,campaign_name,ad_id,ad_name,form_id,form_name,
      full_name,first_name,last_name,email,phone,whatsapp,business_name,city,state,service_interest,
      source_url,utm_source,utm_medium,utm_campaign,utm_content,utm_term,consent,status,extra_fields
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,'Received',$27
    )
    ON CONFLICT (provider,external_id) DO UPDATE SET
      platform=EXCLUDED.platform,
      campaign_id=COALESCE(NULLIF(EXCLUDED.campaign_id,''),ad_lead_events.campaign_id),
      campaign_name=COALESCE(NULLIF(EXCLUDED.campaign_name,''),ad_lead_events.campaign_name),
      ad_id=COALESCE(NULLIF(EXCLUDED.ad_id,''),ad_lead_events.ad_id),
      ad_name=COALESCE(NULLIF(EXCLUDED.ad_name,''),ad_lead_events.ad_name),
      form_id=COALESCE(NULLIF(EXCLUDED.form_id,''),ad_lead_events.form_id),
      form_name=COALESCE(NULLIF(EXCLUDED.form_name,''),ad_lead_events.form_name),
      full_name=COALESCE(NULLIF(EXCLUDED.full_name,''),ad_lead_events.full_name),
      first_name=COALESCE(NULLIF(EXCLUDED.first_name,''),ad_lead_events.first_name),
      last_name=COALESCE(NULLIF(EXCLUDED.last_name,''),ad_lead_events.last_name),
      email=COALESCE(NULLIF(EXCLUDED.email,''),ad_lead_events.email),
      phone=COALESCE(NULLIF(EXCLUDED.phone,''),ad_lead_events.phone),
      whatsapp=COALESCE(NULLIF(EXCLUDED.whatsapp,''),ad_lead_events.whatsapp),
      business_name=COALESCE(NULLIF(EXCLUDED.business_name,''),ad_lead_events.business_name),
      city=COALESCE(NULLIF(EXCLUDED.city,''),ad_lead_events.city),
      state=COALESCE(NULLIF(EXCLUDED.state,''),ad_lead_events.state),
      service_interest=COALESCE(NULLIF(EXCLUDED.service_interest,''),ad_lead_events.service_interest),
      source_url=COALESCE(NULLIF(EXCLUDED.source_url,''),ad_lead_events.source_url),
      utm_source=COALESCE(NULLIF(EXCLUDED.utm_source,''),ad_lead_events.utm_source),
      utm_medium=COALESCE(NULLIF(EXCLUDED.utm_medium,''),ad_lead_events.utm_medium),
      utm_campaign=COALESCE(NULLIF(EXCLUDED.utm_campaign,''),ad_lead_events.utm_campaign),
      utm_content=COALESCE(NULLIF(EXCLUDED.utm_content,''),ad_lead_events.utm_content),
      utm_term=COALESCE(NULLIF(EXCLUDED.utm_term,''),ad_lead_events.utm_term),
      consent=COALESCE(EXCLUDED.consent,ad_lead_events.consent),
      extra_fields=CASE WHEN EXCLUDED.extra_fields='{}'::jsonb THEN ad_lead_events.extra_fields ELSE EXCLUDED.extra_fields END
    RETURNING *
  `, [
    p.provider,p.external_id,p.platform,p.campaign_id,p.campaign_name,p.ad_id,p.ad_name,p.form_id,p.form_name,
    p.full_name,p.first_name,p.last_name,p.email,p.phone,p.whatsapp,p.business_name,p.city,p.state,p.service_interest,
    p.source_url,p.utm_source,p.utm_medium,p.utm_campaign,p.utm_content,p.utm_term,p.consent,JSON.stringify(p.extra_fields || {}),
  ]);
  return r.rows[0];
}

async function findExistingLead(p) {
  if (p.email) {
    const byEmail = await db.one("SELECT * FROM leads WHERE deleted_at IS NULL AND LOWER(BTRIM(email))=$1 ORDER BY created_at DESC LIMIT 1", [p.email.toLowerCase()]);
    if (byEmail) return byEmail;
  }
  const phone = normPhone(p.phone || p.whatsapp);
  if (phone.length >= 10) {
    const byPhone = await db.one(`
      SELECT * FROM leads
       WHERE deleted_at IS NULL
         AND RIGHT(regexp_replace(COALESCE(phone,''),'[^0-9]','','g'),10)=$1
       ORDER BY created_at DESC LIMIT 1
    `, [phone.slice(-10)]);
    if (byPhone) return byPhone;
  }
  return null;
}

async function notifyManagers(lead, p) {
  const managers = await db.all(`
    SELECT DISTINCT u.id
      FROM users u
      LEFT JOIN roles r ON r.id=u.role_id
     WHERE u.active=TRUE AND u.deleted_at IS NULL
       AND (
         r.name IN ('Super Admin','Admin','CEO','Sales Manager')
         OR LOWER(COALESCE(r.name,'')) LIKE '%director%'
       )
  `);
  const title = `New ${providerLabel(p.provider)} lead`;
  const body = clip(`${lead.business_name || p.full_name || "New prospect"}${p.campaign_name ? ` · ${p.campaign_name}` : ""} is waiting for manager assignment.`, 500);
  for (const m of managers) {
    await db.query(
      "INSERT INTO notifications (user_id,title,body,link,kind) VALUES ($1,$2,$3,$4,'lead')",
      [m.id, title, body, `/leads?open=${lead.id}`],
    );
  }
}

async function promoteEvent(event, p) {
  if (event.lead_id) {
    const existing = await db.one("SELECT * FROM leads WHERE id=$1 AND deleted_at IS NULL", [event.lead_id]);
    if (existing) return { event, lead: existing, duplicate: event.status === "Linked Existing" };
  }

  const match = await findExistingLead(p);
  if (match) {
    const updated = await db.one(`
      UPDATE ad_lead_events
         SET lead_id=$1,status='Linked Existing',error='',processed_at=now()
       WHERE id=$2 RETURNING *
    `, [match.id, event.id]);
    return { event: updated, lead: match, duplicate: true };
  }

  const source = providerLabel(p.provider);
  await db.query("INSERT INTO lead_sources (name) VALUES ($1) ON CONFLICT (name) DO NOTHING", [source]);

  const businessName = clip(p.business_name || p.full_name || p.campaign_name || `${source} Lead`, 240) || `${source} Lead`;
  const contact = clip(p.full_name || `${p.first_name} ${p.last_name}`.trim(), 240);
  const notes = [
    p.campaign_name ? `Campaign: ${p.campaign_name}` : "",
    p.ad_name ? `Ad: ${p.ad_name}` : "",
    p.form_name ? `Form: ${p.form_name}` : "",
    p.service_interest ? `Interested in: ${p.service_interest}` : "",
    p.utm_campaign ? `UTM campaign: ${p.utm_campaign}` : "",
    `Imported automatically from ${source}. Manager/CEO/Director must allot this lead before a salesperson can see it.`,
  ].filter(Boolean).join("\n");

  const code = await nextCode(db, "leads", "lead_code", "LD");
  const leadData = {
    email: p.email, phone: p.phone, website: "", source,
  };
  const r = await db.query(`
    INSERT INTO leads (
      lead_code,business_name,first_name,last_name,company_name,contact_person,
      email,phone,whatsapp,category,source,source_url,city,state,status,priority,
      validation,notes,created_by,assigned_user_id,assigned_team_id
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'New','Medium',$15,$16,NULL,NULL,NULL
    ) RETURNING *
  `, [
    code,businessName,p.first_name || "",p.last_name || "",p.business_name || "",contact,
    p.email || "",p.phone || "",p.whatsapp || p.phone || "",p.service_interest || "",source,p.source_url || "",
    p.city || "",p.state || "",validateLead(leadData),notes,
  ]);
  const lead = r.rows[0];
  await db.query(
    "INSERT INTO lead_scores (lead_id,score,temperature,intent,action,reason,scored_by) VALUES ($1,0,'Cold','Low','','Awaiting qualification','ads')",
    [lead.id],
  );
  const updated = await db.one(`
    UPDATE ad_lead_events
       SET lead_id=$1,status='Lead Created',error='',processed_at=now()
     WHERE id=$2 RETURNING *
  `, [lead.id, event.id]);
  await db.query(
    "INSERT INTO audit_logs (user_id,user_name,action,target,detail) VALUES (NULL,'Ads Integration','Ad Lead Captured',$1,$2)",
    [`lead:${lead.id}`, clip(`${source}; campaign=${p.campaign_name || p.campaign_id || "unknown"}; external=${p.external_id}`, 1000)],
  );
  await notifyManagers(lead, p);
  return { event: updated, lead, duplicate: false };
}

async function ingest(provider, payload) {
  const p = normalizeGeneric(provider, payload);
  const event = await upsertEvent(p);
  return promoteEvent(event, p);
}

function verifyGenericSecret(req) {
  if (!config.adsWebhookSecret) throw new HttpError(503, "Secure ads webhook is not configured");
  const supplied = req.get("x-itct-webhook-secret") || "";
  if (!safeEqual(supplied, config.adsWebhookSecret)) throw new HttpError(401, "Invalid webhook signature");
}

function verifyMetaSignature(req) {
  if (!config.metaAppSecret) throw new HttpError(503, "Meta webhook is not configured");
  const supplied = req.get("x-hub-signature-256") || "";
  const raw = req.rawBody;
  if (!Buffer.isBuffer(raw) || !raw.length) throw new HttpError(401, "Missing signed webhook body");
  const expected = "sha256=" + crypto.createHmac("sha256", config.metaAppSecret).update(raw).digest("hex");
  if (!safeEqual(supplied, expected)) throw new HttpError(401, "Invalid Meta webhook signature");
}

async function fetchMetaLead(leadgenId) {
  if (!config.metaPageAccessToken) throw new HttpError(503, "Meta Page access token is not configured");
  const base = "https://graph.facebook.com";
  const prefix = config.metaGraphVersion ? `/${encodeURIComponent(config.metaGraphVersion)}` : "";
  const proof = config.metaAppSecret
    ? crypto.createHmac("sha256", config.metaAppSecret).update(config.metaPageAccessToken).digest("hex")
    : "";
  const fields = [
    "id","created_time","ad_id","ad_name","campaign_id","campaign_name","form_id","form_name","field_data",
  ];
  const minimal = ["id","created_time","ad_id","form_id","field_data"];

  const request = async (wanted) => {
    const qs = new URLSearchParams({ fields: wanted.join(",") });
    if (proof) qs.set("appsecret_proof", proof);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetch(`${base}${prefix}/${encodeURIComponent(leadgenId)}?${qs.toString()}`, {
        headers: { Authorization: `Bearer ${config.metaPageAccessToken}` },
        signal: controller.signal,
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(clip(json?.error?.message || `Meta Graph API returned ${res.status}`, 500));
      return json;
    } finally { clearTimeout(timer); }
  };

  try { return await request(fields); }
  catch (first) {
    if (String(first?.name || "") === "AbortError") throw first;
    return request(minimal);
  }
}

router.get("/integrations/ads/meta", publicRateLimit, (req, res, next) => {
  try {
    if (!config.metaWebhookVerifyToken) throw new HttpError(503, "Meta webhook verification is not configured");
    const mode = String(req.query["hub.mode"] || "");
    const token = String(req.query["hub.verify_token"] || "");
    const challenge = String(req.query["hub.challenge"] || "");
    if (mode !== "subscribe" || !safeEqual(token, config.metaWebhookVerifyToken))
      throw new HttpError(403, "Meta webhook verification failed");
    res.type("text/plain").send(challenge);
  } catch (e) { next(e); }
});

router.post("/integrations/ads/meta", publicRateLimit, async (req, res, next) => {
  try {
    verifyMetaSignature(req);
    if (!config.metaPageAccessToken) throw new HttpError(503, "Meta lead retrieval is not configured");

    const notifications = [];
    for (const entry of Array.isArray(req.body?.entry) ? req.body.entry : []) {
      for (const change of Array.isArray(entry?.changes) ? entry.changes : []) {
        if (change?.field !== "leadgen" || !change?.value?.leadgen_id) continue;
        notifications.push(change.value);
      }
    }

    for (const notification of notifications.slice(0, 50)) {
      const leadgenId = clip(notification.leadgen_id, 220);
      try {
        const record = await fetchMetaLead(leadgenId);
        const p = normalizeMetaFields(record, notification);
        const event = await upsertEvent(p);
        await promoteEvent(event, p);
      } catch (e) {
        const p = normalizeGeneric("meta", {
          external_id: leadgenId,
          platform: "Meta (Facebook / Instagram)",
          ad_id: notification.ad_id,
          form_id: notification.form_id,
        });
        const event = await upsertEvent(p);
        await db.query(
          "UPDATE ad_lead_events SET status='Fetch Failed',error=$1 WHERE id=$2",
          [clip(e?.message || "Meta lead fetch failed", 1000), event.id],
        );
      }
    }

    res.json({ ok: true, accepted: notifications.length });
  } catch (e) { next(e); }
});

router.post("/integrations/ads/ingest/:provider", publicRateLimit, async (req, res, next) => {
  try {
    verifyGenericSecret(req);
    const provider = clip(req.params.provider, 40).toLowerCase();
    if (!PUBLIC_PROVIDERS.has(provider)) throw new HttpError(422, "Unsupported ads provider");
    if (!req.body || typeof req.body !== "object" || Array.isArray(req.body))
      throw new HttpError(422, "JSON lead payload is required");

    const result = await ingest(provider, req.body);
    res.status(result.duplicate ? 200 : 201).json({
      ok: true,
      event_id: result.event.id,
      lead_id: result.lead.id,
      duplicate: result.duplicate,
      status: result.event.status,
    });
  } catch (e) { next(e); }
});

router.get("/ads-leads/status", requirePerm("ads", "view"), async (_req, res, next) => {
  try {
    const counts = await db.one(`
      SELECT COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE status='Lead Created')::int AS created,
             COUNT(*) FILTER (WHERE status='Linked Existing')::int AS linked,
             COUNT(*) FILTER (WHERE status='Fetch Failed')::int AS failed
        FROM ad_lead_events
    `);
    res.json({
      integrations: {
        meta: {
          configured: !!(config.metaWebhookVerifyToken && config.metaAppSecret && config.metaPageAccessToken),
          endpoint: "/api/integrations/ads/meta",
          provider: "Meta Lead Ads (Facebook / Instagram)",
        },
        secure_webhook: {
          configured: !!config.adsWebhookSecret,
          endpoint: "/api/integrations/ads/ingest/:provider",
          providers: [...PUBLIC_PROVIDERS].filter((p) => p !== "meta"),
          auth_header: "X-ITCT-Webhook-Secret",
        },
      },
      counts: {
        total: Number(counts?.total || 0),
        created: Number(counts?.created || 0),
        linked: Number(counts?.linked || 0),
        failed: Number(counts?.failed || 0),
      },
    });
  } catch (e) { next(e); }
});

router.get("/ads-leads", requirePerm("ads", "view"), async (req, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page || 1));
    const pageSize = Math.min(100, Math.max(10, Number(req.query.page_size || 30)));
    const where = ["1=1"];
    const params = [];
    const provider = clip(req.query.provider, 40).toLowerCase();
    const status = clip(req.query.status, 80);
    const search = clip(req.query.search, 200);
    if (provider) { params.push(provider); where.push(`provider=$${params.length}`); }
    if (status) { params.push(status); where.push(`status=$${params.length}`); }
    if (search) {
      params.push(`%${search}%`);
      where.push(`(full_name ILIKE $${params.length} OR business_name ILIKE $${params.length}
        OR email ILIKE $${params.length} OR phone ILIKE $${params.length}
        OR campaign_name ILIKE $${params.length} OR ad_name ILIKE $${params.length})`);
    }
    const total = Number((await db.one(`SELECT COUNT(*)::int AS n FROM ad_lead_events WHERE ${where.join(" AND ")}`, params))?.n || 0);
    params.push(pageSize, (page - 1) * pageSize);
    const rows = await db.all(`
      SELECT a.*, l.lead_code, l.status AS lead_status, l.assigned_user_id,
             u.name AS assigned_user_name
        FROM ad_lead_events a
        LEFT JOIN leads l ON l.id=a.lead_id AND l.deleted_at IS NULL
        LEFT JOIN users u ON u.id=l.assigned_user_id
       WHERE ${where.join(" AND ")}
       ORDER BY a.received_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}
    `, params);
    res.json({ items: rows, total, page, page_size: pageSize });
  } catch (e) { next(e); }
});

router.post("/ads-leads/:id/retry", requirePerm("ads", "edit"), async (req, res, next) => {
  try {
    const event = await db.one("SELECT * FROM ad_lead_events WHERE id=$1", [Number(req.params.id)]);
    if (!event) throw new HttpError(404, "Ad lead event not found");
    if (event.lead_id) return res.json({ ok: true, event_id: event.id, lead_id: event.lead_id, status: event.status });
    if (event.provider !== "meta") throw new HttpError(409, "Only Meta fetch failures can be retried automatically");

    const record = await fetchMetaLead(event.external_id);
    const p = normalizeMetaFields(record, { leadgen_id: event.external_id, ad_id: event.ad_id, form_id: event.form_id });
    const updated = await upsertEvent(p);
    const result = await promoteEvent(updated, p);
    res.json({ ok: true, event_id: result.event.id, lead_id: result.lead.id, status: result.event.status });
  } catch (e) { next(e); }
});

module.exports = { router, normalizeGeneric, normalizeMetaFields, safeEqual };
