/** Company Owner profile/settings write endpoint. */
const express = require("express");
const { db } = require("../db");
const { HttpError } = require("../core");
const { requireAuth } = require("../security");

const router = express.Router();
const OWNER_ROLES = new Set(["Super Admin", "Admin", "Company Owner"]);
const allowed = [
  "name", "legalName", "ownerName", "tagline", "email", "phone", "website", "address", "city", "state", "postalCode",
  "gstin", "pan", "cin", "currency", "timezone", "logoMark", "bankName", "accountName", "accountNumber", "ifsc",
];

router.put("/settings/company", requireAuth, async (req, res, next) => {
  try {
    if (!OWNER_ROLES.has(req.role.name)) throw new HttpError(403, "Only the Company Owner or an administrator can edit company details");
    const raw = req.body?.company || {};
    const company = {};
    for (const key of allowed) if (raw[key] !== undefined) company[key] = typeof raw[key] === "string" ? raw[key].trim() : raw[key];
    if (!String(company.name || "").trim()) throw new HttpError(422, "Company name is required");
    const existing = await db.one("SELECT value FROM crm_settings WHERE key = 'company'");
    const merged = { ...(existing?.value || {}), ...company };
    await db.query(
      `INSERT INTO crm_settings (key, value) VALUES ('company',$1)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [JSON.stringify(merged)],
    );
    await db.query(
      "INSERT INTO audit_logs (user_id, user_name, action, target, detail) VALUES ($1,$2,$3,$4,$5)",
      [req.user.id, req.user.name, "Company Details Updated", "settings:company", String(company.name)],
    );
    res.json({ ok: true, company: merged });
  } catch (e) { next(e); }
});

module.exports = router;
