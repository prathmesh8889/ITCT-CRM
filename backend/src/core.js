/**
 * Core utilities — config, errors, money math, record codes, normalisation, CSV.
 */
require("dotenv").config();
const crypto = require("crypto");

const config = {
  port: Number(process.env.PORT || 8000),
  databaseUrl: process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/itct_crm",
  autoMigrate: (process.env.AUTO_MIGRATE || "true") === "true",
  jwtSecret: process.env.JWT_SECRET || "dev-only-change-me",
  accessMinutes: Number(process.env.ACCESS_TOKEN_EXPIRE_MINUTES || 60),
  refreshDays: Number(process.env.REFRESH_TOKEN_EXPIRE_DAYS || 7),
  corsOrigins: (process.env.CORS_ORIGINS || "http://localhost:5173,http://127.0.0.1:5173").split(",").map((s) => s.trim()),
  ollamaUrl: process.env.OLLAMA_BASE_URL || "http://localhost:11434",
  ollamaModel: process.env.OLLAMA_MODEL || "qwen3",
  uploadDir: process.env.UPLOAD_DIR || "uploads",
  maxUploadMb: Number(process.env.MAX_UPLOAD_MB || 10),
  version: "2.0.0",
};

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

/** Round to paise — backend is authoritative for all money math. */
const money = (x) => Math.round((Number(x) || 0) * 100) / 100;

/** Per-line discount + GST totals (matches the frontend preview exactly). */
function computeTotals(items) {
  let subtotal = 0, discountTotal = 0, taxTotal = 0;
  for (const it of items) {
    const gross = Number(it.quantity) * Number(it.rate);
    const disc = gross * (Number(it.discount_percent) / 100);
    subtotal += gross;
    discountTotal += disc;
    taxTotal += (gross - disc) * (Number(it.gst_percent) / 100);
  }
  return { subtotal: money(subtotal), discount_total: money(discountTotal),
           tax_total: money(taxTotal), grand_total: money(subtotal - discountTotal + taxTotal) };
}

/** Collision-safe codes: date-stamped + random, checked against the table (never count+1). */
async function nextCode(db, table, column, prefix) {
  for (let i = 0; i < 6; i++) {
    const stamp = new Date().toISOString().slice(2, 10).replace(/-/g, "");
    const code = `${prefix}-${stamp}-${crypto.randomBytes(2).toString("hex").toUpperCase()}`;
    const r = await db.query(`SELECT 1 FROM ${table} WHERE ${column} = $1`, [code]);
    if (r.rowCount === 0) return code;
  }
  throw new HttpError(500, "Could not allocate a unique record code — retry");
}

// ---------------- normalisation (duplicate detection) ----------------
const normPhone = (p) => { const d = String(p || "").replace(/\D/g, ""); return d.length >= 10 ? d.slice(-10) : d; };
const normDomain = (w) => {
  let s = String(w || "").toLowerCase().trim().replace(/^https?:\/\//, "").split("/")[0];
  return s.startsWith("www.") ? s.slice(4) : s;
};
const normName = (n) => String(n || "").toLowerCase().replace(/[^a-z0-9]/g, "");

function validateLead(l) {
  let ok = 0;
  const email = l.email || "", phone = l.phone || "", website = l.website || "";
  if (email && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) ok++;
  if (phone && normPhone(phone).length === 10) ok++;
  if (website && /^(www\.)?[\w-]+(\.[\w-]+)+/.test(website)) ok++;
  if (!email && !phone) return "Needs Review";
  if (email && phone && ok >= 2) return "Valid";
  if (ok >= 1) return "Partially Valid";
  return "Invalid";
}

// ---------------- minimal CSV (quoted fields supported) ----------------
function parseCSV(text) {
  const rows = []; let row = [], cur = "", inQ = false;
  const src = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQ) {
      if (c === '"') { if (src[i + 1] === '"') { cur += '"'; i++; } else inQ = false; }
      else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { row.push(cur); cur = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(cur); cur = "";
      if (row.some((x) => x.trim() !== "")) rows.push(row);
      row = [];
    } else cur += c;
  }
  row.push(cur);
  if (row.some((x) => x.trim() !== "")) rows.push(row);
  if (!rows.length) return { headers: [], records: [] };
  const headers = rows[0].map((h) => h.trim());
  const records = rows.slice(1).map((r) => Object.fromEntries(headers.map((h, i) => [h, (r[i] || "").trim()])));
  return { headers, records };
}
const toCSV = (rows) => {
  if (!rows.length) return "";
  const keys = Object.keys(rows[0]);
  const esc = (v) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return [keys.join(","), ...rows.map((r) => keys.map((k) => esc(r[k])).join(","))].join("\n");
};

const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");

module.exports = { config, HttpError, money, computeTotals, nextCode, normPhone, normDomain,
                   normName, validateLead, parseCSV, toCSV, sha256 };
