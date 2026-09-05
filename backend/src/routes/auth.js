/**
 * Auth — login (throttled), refresh rotation with reuse detection, logout, me, change-password.
 */
const express = require("express");
const jwt = require("jsonwebtoken");
const { db } = require("../db");
const { config, HttpError, sha256 } = require("../core");
const { hashPassword, verifyPassword, signAccess, signRefresh, newRefreshHash, requireAuth } = require("../security");
const { ensureAuthSchema } = require("../auth-schema");

const router = express.Router();
const normalizeEmail = (value) => String(value || "").trim().toLowerCase();

// Failed-login throttle: keyed by normalized email + IP, stale entries cleaned.
// Different employees on the same office/network IP are isolated because email is part of the key.
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

router.post("/login", async (req, res, next) => {
  try {
    await ensureAuthSchema();
    const email = normalizeEmail(req.body?.email);
    const password = String(req.body?.password || "");
    if (!email || !password) throw new HttpError(422, "Email and password are required");
    const key = `${email}|${req.ip || ""}`;
    const attempts = (failed.get(key) || []).filter((t) => Date.now() - t < WINDOW_MS);
    failed.set(key, attempts);
    if (attempts.length >= MAX_ATTEMPTS)
      throw new HttpError(429, "Too many failed attempts. Try again in 5 minutes.");

    const user = await db.one(
      "SELECT * FROM users WHERE LOWER(BTRIM(email)) = $1 AND deleted_at IS NULL ORDER BY id LIMIT 1",
      [email],
    );
    if (!user || !verifyPassword(password, user.password_hash)) {
      attempts.push(Date.now()); failed.set(key, attempts);
      await audit(user?.id ?? null, user?.name ?? email, "Failed Login", "auth", "Invalid credentials");
      throw new HttpError(401, "Invalid email or password");
    }
    if (!user.active) {
      await audit(user.id, user.name, "Failed Login", "auth", "Account disabled");
      throw new HttpError(403, "Account is disabled. Contact your admin.");
    }

    const role = await db.one("SELECT * FROM roles WHERE id = $1", [user.role_id]);
    const refresh = signRefresh(user);
    await db.query("INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1,$2,$3)",
      [user.id, sha256(refresh), new Date(Date.now() + config.refreshDays * 86400_000)]);
    await db.query("UPDATE users SET last_login_at = now() WHERE id = $1", [user.id]);
    failed.delete(key);
    await audit(user.id, user.name, "Login", "auth", user.must_change_password ? "Successful login; password change required" : "Successful login");
    res.json({ access_token: signAccess(user, role?.name || ""), refresh_token: refresh, token_type: "bearer" });
  } catch (e) { next(e); }
});

router.post("/refresh", async (req, res, next) => {
  try {
    await ensureAuthSchema();
    const token = String(req.body?.refresh_token || "");
    let payload;
    try { payload = jwt.verify(token, config.jwtSecret); } catch { throw new HttpError(401, "Invalid refresh token"); }
    if (payload.type !== "refresh") throw new HttpError(401, "Invalid token type");
    const row = await db.one("SELECT * FROM refresh_tokens WHERE token_hash = $1", [sha256(token)]);
    if (!row || row.expires_at < new Date()) throw new HttpError(401, "Refresh token expired");
    if (row.revoked) {
      await db.query("UPDATE refresh_tokens SET revoked = TRUE WHERE user_id = $1", [row.user_id]);
      throw new HttpError(401, "Refresh token reuse detected — session revoked");
    }
    const user = await db.one("SELECT * FROM users WHERE id = $1 AND deleted_at IS NULL", [row.user_id]);
    if (!user || !user.active) throw new HttpError(401, "Account is disabled");
    await db.query("UPDATE refresh_tokens SET revoked = TRUE WHERE id = $1", [row.id]);
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
    await ensureAuthSchema();
    const { old_password, new_password } = req.body || {};
    if (!verifyPassword(String(old_password || ""), req.user.password_hash))
      throw new HttpError(422, "Current password is incorrect");
    if (!new_password || String(new_password).length < 8)
      throw new HttpError(422, "New password must be at least 8 characters");
    if (String(old_password || "") === String(new_password))
      throw new HttpError(422, "New password must be different from the temporary/current password");
    await db.query("UPDATE users SET password_hash = $1, must_change_password = FALSE WHERE id = $2", [hashPassword(new_password), req.user.id]);
    await db.query("UPDATE refresh_tokens SET revoked = TRUE WHERE user_id = $1", [req.user.id]);
    await audit(req.user.id, req.user.name, "Password Changed", `user:${req.user.email}`, "Password change requirement cleared");
    res.json({ ok: true, must_change_password: false });
  } catch (e) { next(e); }
});

module.exports = router;
