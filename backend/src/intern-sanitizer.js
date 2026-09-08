/** Level-6 response sanitization from the Workforce OS zero-leakage policy.
 * Mounted before protected API routes; route-level requireAuth fills req.accessLevel
 * before res.json is eventually called.
 */
const PHONE_MASK = "+91-XXXXX-XXXXX";
const EMAIL_MASK = "XXXXX@XXXXX.XXX";

const sensitiveKey = (key) => {
  const k = String(key || "").toLowerCase();
  if (k.includes("email")) return "email";
  if (k.includes("phone") || k.includes("whatsapp")) return "phone";
  return null;
};

function sanitize(value) {
  if (Array.isArray(value)) return value.map(sanitize);
  if (!value || typeof value !== "object") return value;
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    const kind = sensitiveKey(key);
    if (kind && item) out[key] = kind === "email" ? EMAIL_MASK : PHONE_MASK;
    else out[key] = sanitize(item);
  }
  return out;
}

function internSanitizer(req, res, next) {
  const originalJson = res.json.bind(res);
  res.json = (body) => {
    if (Number(req.accessLevel) === 6) return originalJson(sanitize(body));
    return originalJson(body);
  };
  next();
}

module.exports = { internSanitizer, sanitize, PHONE_MASK, EMAIL_MASK };
