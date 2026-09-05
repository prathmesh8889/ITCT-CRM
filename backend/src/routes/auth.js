/**
 * Auth — password login, Google sign-in, refresh rotation, logout, me, change-password.
 */
const express = require("express");
const jwt = require("jsonwebtoken");
const { OAuth2Client } = require("google-auth-library");
const { db } = require("../db");
const { config, HttpError, sha256 } = require("../core");
const { hashPassword, verifyPassword, signAccess, signRefresh, newRefreshHash, requireAuth } = require("../security");

const router = express.Router();
const GOOGLE_CLIENT_ID = String(process.env.GOOGLE_CLIENT_ID || "").trim();
const googleClient = GOOGLE_CLIENT_ID ? new OAuth2Client(GOOGLE_CLIENT_ID) : null;

// Failed-login throttle: keyed by normalized email + IP, stale entries cleaned.
// Production: move to Redis/shared store for multi-instance deployments.
const failed = new Map();
const MAX_ATTEMPTS = 5, WINDOW_MS = 5 * 60_000;
setInterval(() => {
  const now = Date.now();
  for (const [k, arr] of failed) {
    const keep = arr.filter((t) => now - t < WINDOW_MS);
    keep.length ? failed.set(k, keep) : failed.delete(k);
  }
}, 10 * 60_000).unref?.();

const audit = (userId, userName, action, target, detail = "") =>
  db.query("INSERT INTO audit_logs (user_id, user_name, action, target, detail) VALUES ($1,$2,$3,$4,$5)",
    [userId, userName, action, target, detail]);

async function issueSession(user, detail = "Successful login") {
  const role = await db.one("SELECT * FROM roles WHERE id = $1", [user.role_id]);
  const refresh = signRefresh(user);
  await db.query("INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1,$2,$3)",
    [user.id, sha256(refresh), new Date(Date.now() + config.refreshDays * 86400_000)]);
  await db.query("UPDATE users SET last_login_at = now() WHERE id = $1", [user.id]);
  await audit(user.id, user.name, "Login", "auth", detail);
  return { access_token: signAccess(user, role?.name || ""), refresh_token: refresh, token_type: "bearer" };
}

router.post("/login", async (req, res, next) => {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const password = String(req.body?.password || "");
    if (!email || !password) throw new HttpError(422, "Email and password are required");
    const key = `${email}|${req.ip || ""}`;
    const attempts = (failed.get(key) || []).filter((t) => Date.now() - t < WINDOW_MS);
    failed.set(key, attempts);
    if (attempts.length >= MAX_ATTEMPTS)
      throw new HttpError(429, "Too many failed attempts. Try again in 5 minutes.");

    const user = await db.one("SELECT * FROM users WHERE email = $1 AND deleted_at IS NULL", [email]);
    if (!user || !verifyPassword(password, user.password_hash)) {
      attempts.push(Date.now()); failed.set(key, attempts);
      await audit(user?.id ?? null, user?.name ?? email, "Failed Login", "auth", "Invalid credentials");
      throw new HttpError(401, "Invalid email or password");
    }
    if (!user.active) {
      await audit(user.id, user.name, "Failed Login", "auth", "Account disabled");
      throw new HttpError(403, "Account is disabled. Contact your admin.");
    }

    failed.delete(key);
    res.json(await issueSession(user, "Successful password login"));
  } catch (e) { next(e); }
});

// Google Identity Services sends an ID token (credential). Google proves the
// identity; ITCT CRM still decides authorization. We NEVER auto-create users:
// the verified email must already belong to an active CRM employee.
router.post("/google", async (req, res, next) => {
  try {
    if (!googleClient || !GOOGLE_CLIENT_ID)
      throw new HttpError(503, "Google sign-in is not configured by the CRM administrator");
    const credential = String(req.body?.credential || "").trim();
    if (!credential) throw new HttpError(422, "Google credential is required");

    let payload;
    try {
      const ticket = await googleClient.verifyIdToken({ idToken: credential, audience: GOOGLE_CLIENT_ID });
      payload = ticket.getPayload();
    } catch {
      throw new HttpError(401, "Google sign-in could not be verified");
    }

    const email = String(payload?.email || "").trim().toLowerCase();
    if (!email || payload?.email_verified !== true)
      throw new HttpError(401, "Google account email is not verified");

    const user = await db.one("SELECT * FROM users WHERE email = $1 AND deleted_at IS NULL", [email]);
    if (!user) {
      await audit(null, email, "Failed Google Login", "auth", "Google email is not provisioned in CRM");
      throw new HttpError(403, "No CRM employee account is linked to this Google email. Ask your admin to create the employee first.");
    }
    if (!user.active) {
      await audit(user.id, user.name, "Failed Google Login", "auth", "Account disabled");
      throw new HttpError(403, "Account is disabled. Contact your admin.");
    }

    res.json(await issueSession(user, "Successful Google login"));
  } catch (e) { next(e); }
});

router.post("/refresh", async (req, res, next) => {
  try {
    const token = String(req.body?.refresh_token || "");
    let payload;
    try { payload = jwt.verify(token, config.jwtSecret); } catch { throw new HttpError(401, "Invalid refresh token"); }
    if (payload.type !== "refresh") throw new HttpError(401, "Invalid token type");
    const row = await db.one("SELECT * FROM refresh_tokens WHERE token_hash = $1", [sha256(token)]);
    if (!row || row.expires_at < new Date()) throw new HttpError(401, "Refresh token expired");
    if (row.revoked) {
      // Reuse of a revoked token ⇒ treat as theft: kill the whole session family.
      await db.query("UPDATE refresh_tokens SET revoked = TRUE WHERE user_id = $1", [row.user_id]);
      throw new HttpError(401, "Refresh token reuse detected — session revoked");
    }
    const user = await db.one("SELECT * FROM users WHERE id = $1 AND deleted_at IS NULL", [row.user_id]);
    if (!user || !user.active) throw new HttpError(401, "Account is disabled");
    row.revoked = true;
    await db.query("UPDATE refresh_tokens SET revoked = TRUE WHERE id = $1", [row.id]); // rotation
    const refresh = signRefresh(user);
    await db.query("INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1,$2,$3)",
      [user.id, sha256(refresh), new Date(Date.now() + config.refreshDays * 86400_000)]);
    const role = await db.one("SELECT * FROM roles WHERE id = $1", [user.role_id]);
    res.json({ access_token: signAccess(user, role?.name || ""), refresh_token: refresh, token_type: "bearer" });
  } catch (e) { next(e); }
});

router.post("/logout", requireAuth, async (req, res, next) => {
  try {
    await db.query("UPDATE refresh_tokens SET revoked = TRUE WHERE user_id = $1", [req.user.id]);
    await audit(req.user.id, req.user.name, "Logout", "auth");
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.get("/me", requireAuth, async (req, res, next) => {
  try {
    const { password_hash, ...user } = req.user;
    res.json({ user, role: req.role.name, perms: req.role.perms || {},
               is_super: ["Super Admin", "Admin"].includes(req.role.name) });
  } catch (e) { next(e); }
});

router.post("/change-password", requireAuth, async (req, res, next) => {
  try {
    const { old_password, new_password } = req.body || {};
    if (!verifyPassword(String(old_password || ""), req.user.password_hash))
      throw new HttpError(400, "Current password is incorrect");
    if (!new_password || String(new_password).length < 8)
      throw new HttpError(422, "New password must be at least 8 characters");
    await db.query("UPDATE users SET password_hash = $1 WHERE id = $2", [hashPassword(new_password), req.user.id]);
    await db.query("UPDATE refresh_tokens SET revoked = TRUE WHERE user_id = $1", [req.user.id]);
    await audit(req.user.id, req.user.name, "Password Changed", `user:${req.user.email}`);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
