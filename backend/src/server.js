/**
 * ITCT CRM API — Node.js + Express + PostgreSQL.
 * Run: npm start (or: node src/server.js) → http://localhost:8000
 */
const express = require("express");
const cors = require("cors");
const { db, initSchema } = require("./db");
const { config, HttpError } = require("./core");
const { sweepOverdueInvoices } = require("./engines");
const { cleanupDemoData } = require("./cleanup-demo");
const { router: crmRoutes, startDiscoveryWorker } = require("./routes/crm");

const app = express();
app.set("trust proxy", true);
app.disable("x-powered-by");
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  next();
});
app.use(cors({ origin: config.corsOrigins, credentials: true }));
app.use(express.json({ limit: "2mb" }));

// ---------------- health (503 when the database is down) ----------------
app.get("/api/health", async (_req, res) => {
  try {
    await db.query("SELECT 1");
    const cleanup = await db.one("SELECT value FROM crm_settings WHERE key = 'demo_cleanup_v1'");
    res.json({
      status: "ok",
      database: "connected",
      version: config.version,
      demo_data: cleanup ? "clean" : "pending_cleanup",
    });
  } catch (e) {
    console.error("[health] database check failed:", e.message);
    res.status(503).json({ status: "degraded", database: "disconnected", version: config.version });
  }
});

// ---------------- routers ----------------
app.use("/api/auth", require("./routes/auth"));
app.use("/api", crmRoutes);
app.use("/api", require("./routes/billing"));
// Mounted before the legacy analytics router so employee dashboard requests are
// always ownership- and permission-scoped server-side.
app.use("/api", require("./routes/dashboard"));
// Employee creation needs special handling for a previously soft-deleted email.
// Mount this before the broader admin router so POST /users is handled here.
app.use("/api", require("./routes/user-create"));
app.use("/api", require("./routes/admin"));

app.use("/api", (_req, res) => res.status(404).json({ detail: "Not Found" }));

// structured errors — never leak stack traces to clients
app.use((err, req, res, _next) => {
  if (err instanceof HttpError) return res.status(err.status).json({ detail: err.message });
  if (err?.type === "entity.parse.failed") return res.status(422).json({ detail: "Invalid JSON body" });
  console.error(`[error] ${req.method} ${req.originalUrl}:`, err);
  res.status(err?.status || 500).json({ detail: err?.status ? err.message : "Internal server error" });
});

// ---------------- boot ----------------
async function main() {
  if (config.autoMigrate) {
    try {
      await initSchema();
      console.log("[boot] schema ready (CREATE TABLE IF NOT EXISTS)");
    } catch (e) {
      console.error(`[boot] FATAL — cannot reach PostgreSQL at ${config.databaseUrl}\n       ${e.message}`);
      process.exit(1);
    }
  }
  try {
    const result = await cleanupDemoData();
    console.log(`[boot] demo cleanup: ${JSON.stringify(result)}`);
  } catch (e) {
    console.error("[boot] demo cleanup failed (continuing):", e.message);
  }
  try {
    const swept = await sweepOverdueInvoices();
    if (swept) console.log(`[boot] invoice sweep marked ${swept} invoice(s) overdue`);
  } catch (e) { console.error("[boot] sweep failed (continuing):", e.message); }
  startDiscoveryWorker();
  app.listen(config.port, () => {
    console.log(`[boot] ITCT CRM API v${config.version} listening on http://localhost:${config.port}`);
    console.log(`[boot] try: curl http://localhost:${config.port}/api/health`);
  });
}

if (require.main === module) main();

module.exports = { app };
