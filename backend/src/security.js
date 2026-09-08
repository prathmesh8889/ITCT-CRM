/**
 * Auth + RBAC + record ownership. Backend is the enforcement authority —
 * the frontend only hides what the API would refuse anyway.
 */
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const { config, HttpError, sha256 } = require("./core");
const { db } = require("./db");
const { ensureAccessLevelSchema, effectiveAccessLevel, isValidAccessLevel } = require("./access-levels");

const hashPassword = (plain) => bcrypt.hashSync(plain, 10);
const verifyPassword = (plain, hash) => { try { return bcrypt.compareSync(plain, hash); } catch { return false; } };

const signAccess = (user, roleName) =>
  jwt.sign({ sub: String(user.id), role: roleName, type: "access" }, config.jwtSecret,
           { expiresIn: `${config.accessMinutes}m` });
const signRefresh = (user) =>
  jwt.sign({
    sub: String(user.id),
    type: "refresh",
    nonce: crypto.randomBytes(16).toString("hex"),
  }, config.jwtSecret, { expiresIn: `${config.refreshDays}d` });
const newRefreshHash = () => sha256(crypto.randomBytes(32).toString("hex"));

// ---------------- RBAC catalog ----------------
const MODULES = ["dashboard", "leads", "discovery", "customers", "companies", "contacts", "deals",
  "followups", "tasks", "meetings", "calendar", "calls", "products", "quotations", "invoices", "payments",
  "expenses", "employees", "teams", "reports", "notifications", "automation", "audit", "settings"];
const PERMS = ["view", "create", "edit", "delete", "assign", "export", "approve"];
const SUPER_ROLES = new Set(["Super Admin", "Admin"]);

const rolePerms = (roleName, perms, module, perm) => {
  if (SUPER_ROLES.has(roleName)) return true;
  return Array.isArray(perms?.[module]) && perms[module].includes(perm);
};

async function enforceDepartmentRole(user, role) {
  if (SUPER_ROLES.has(role.name) || !String(user.department || "").trim()) return null;
  try {
    const department = await db.one(
      "SELECT id, name, active, allowed_role_ids FROM departments WHERE lower(name) = lower($1)",
      [String(user.department).trim()],
    );
    // Legacy departments remain usable until an admin creates/configures them.
    if (!department) return null;
    if (!department.active) throw new HttpError(403, "Your department is disabled");
    const allowed = Array.isArray(department.allowed_role_ids) ? department.allowed_role_ids.map(Number) : [];
    if (allowed.length && !allowed.includes(Number(role.id)))
      throw new HttpError(403, `Your role is not enabled for the ${department.name} department`);
    return department;
  } catch (e) {
    // Unit tests and pre-migration environments may load auth before the organization schema exists.
    if (e?.code === "42P01") return null;
    throw e;
  }
}

// ---------------- middleware ----------------
async function requireAuth(req, _res, next) {
  try {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;
    if (!token) throw new HttpError(401, "Not authenticated");
    let payload;
    try { payload = jwt.verify(token, config.jwtSecret); } catch { throw new HttpError(401, "Invalid or expired token"); }
    if (payload.type !== "access") throw new HttpError(401, "Invalid token type");

    // Access-level schema is idempotent and cached. Running it here also keeps
    // auth safe in environments where the Express app is imported without the
    // normal server boot sequence.
    await ensureAccessLevelSchema();
    const user = await db.one("SELECT * FROM users WHERE id = $1", [Number(payload.sub)]);
    if (!user || !user.active || user.deleted_at) throw new HttpError(401, "Account is disabled");
    const role = await db.one("SELECT * FROM roles WHERE id = $1", [user.role_id]);
    if (!role) throw new HttpError(403, "Role missing");
    const accessLevel = effectiveAccessLevel(user, role.name);
    if (!isValidAccessLevel(accessLevel)) throw new HttpError(403, "Access level is not configured");
    const department = await enforceDepartmentRole(user, role);

    // A temporary/reset password can authenticate only to auth endpoints needed
    // to inspect the session, change the password, or sign out. CRM data stays locked.
    if (user.must_change_password) {
      const allowed = req.baseUrl === "/api/auth" && ["/me", "/change-password", "/logout"].includes(req.path);
      if (!allowed) throw new HttpError(403, "Password change required before accessing CRM data");
    }

    req.user = user;
    req.role = role;
    req.accessLevel = accessLevel;
    req.department = department;
    next();
  } catch (e) { next(e); }
}

function requirePerm(module, perm) {
  return [requireAuth, (req, _res, next) => {
    if (!rolePerms(req.role.name, req.role.perms, module, perm))
      return next(new HttpError(403, `Permission denied: ${perm} on ${module}`));
    next();
  }];
}

// ---------------- ownership ----------------
const isWide = (role) => SUPER_ROLES.has(role.name) || role.name === "Sales Manager";

/** Sales Executive sees only own records; managers/admins see all. */
const applyOwnership = (req, column) =>
  isWide(req.role) ? { sql: "", params: [] } : { sql: ` AND ${column} = $`, params: [req.user.id] };

async function ensureRow(req, table, id, ownerColumn) {
  const row = await db.one(`SELECT * FROM ${table} WHERE id = $1`, [id]);
  const gone = !row || row.deleted_at;
  if (gone) throw new HttpError(404, "Record not found");
  if (!isWide(req.role) && ownerColumn && row[ownerColumn] !== req.user.id)
    throw new HttpError(403, "You do not own this record");
  return row;
}
const ensureLead = (req, id) => ensureRow(req, "leads", id, "assigned_user_id");
const ensureCustomer = (req, id) => ensureRow(req, "customers", id, "account_manager_id");
const ensureDeal = (req, id) => ensureRow(req, "deals", id, "assigned_user_id");
const ensureFollowup = (req, id) => ensureRow(req, "followups", id, "employee_id");
const ensureTask = (req, id) => ensureRow(req, "tasks", id, "assigned_to_id");
const ensureQuotation = (req, id) => ensureRow(req, "quotations", id, "created_by");
const ensureInvoice = (req, id) => ensureRow(req, "invoices", id, "created_by");

module.exports = {
  hashPassword, verifyPassword, signAccess, signRefresh, newRefreshHash,
  MODULES, PERMS, SUPER_ROLES, rolePerms, requireAuth, requirePerm, isWide,
  applyOwnership, ensureLead, ensureCustomer, ensureDeal, ensureFollowup, ensureTask,
  ensureQuotation, ensureInvoice,
};
