/**
 * Auth + RBAC + Workforce OS record scope. Backend is the enforcement authority.
 */
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const { config, HttpError, sha256 } = require("./core");
const { db } = require("./db");
const { ensureAccessLevelSchema, effectiveAccessLevel, isValidAccessLevel } = require("./access-levels");
const { scopedUserIds } = require("./workforce-scope");

const hashPassword = (plain) => bcrypt.hashSync(plain, 12);
const verifyPassword = (plain, hash) => { try { return bcrypt.compareSync(plain, hash); } catch { return false; } };

function passwordPolicyError(value) {
  const password = String(value || "");
  if (password.length < 12) return "Password must be at least 12 characters";
  if (password.length > 128) return "Password must be 128 characters or fewer";
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password) || !/[^A-Za-z0-9]/.test(password))
    return "Password must include uppercase, lowercase, number, and symbol";
  return null;
}

const jwtOptions = (expiresIn) => ({
  expiresIn,
  issuer: config.jwtIssuer,
  audience: config.jwtAudience,
  algorithm: "HS256",
});
const verifyJwt = (token) => jwt.verify(token, config.jwtSecret, {
  algorithms: ["HS256"],
  issuer: config.jwtIssuer,
  audience: config.jwtAudience,
});

const signAccess = (user, roleName) =>
  jwt.sign({ sub: String(user.id), role: roleName, type: "access" }, config.jwtSecret,
           jwtOptions(`${config.accessMinutes}m`));
const signRefresh = (user) =>
  jwt.sign({
    sub: String(user.id),
    type: "refresh",
    nonce: crypto.randomBytes(16).toString("hex"),
  }, config.jwtSecret, jwtOptions(`${config.refreshDays}d`));
const newRefreshHash = () => sha256(crypto.randomBytes(32).toString("hex"));

// ---------------- RBAC catalog ----------------
const MODULES = ["dashboard", "targets", "leads", "discovery", "customers", "companies", "contacts", "deals",
  "followups", "tasks", "meetings", "calendar", "calls", "products", "quotations", "invoices", "payments",
  "expenses", "employees", "teams", "departments", "access_levels", "reports", "notifications",
  "automation", "audit", "settings"];
const PERMS = ["view", "create", "edit", "delete", "assign", "export", "approve"];
const SUPER_ROLES = new Set(["Super Admin", "Admin"]);
const SUPER_ADMIN_ROLE = "Super Admin";
const MODULE_ALIASES = { departments: "employees", access_levels: "employees" };

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj || {}, key);
const cleanPermissionMap = (value = {}) => {
  const out = {};
  for (const [module, perms] of Object.entries(value || {})) {
    if (!MODULES.includes(module)) continue;
    out[module] = Array.isArray(perms) ? [...new Set(perms.filter((p) => PERMS.includes(p)))] : [];
  }
  return out;
};
const defaultModulePerms = (roleName, perms, module) => {
  if (roleName === SUPER_ADMIN_ROLE || roleName === "Admin") return [...PERMS];
  const direct = Array.isArray(perms?.[module]) ? perms[module] : null;
  if (direct) return direct.filter((p) => PERMS.includes(p));
  const alias = MODULE_ALIASES[module];
  return alias && Array.isArray(perms?.[alias]) ? perms[alias].filter((p) => PERMS.includes(p)) : [];
};
const effectivePermissionMap = (roleName, perms, overrides = {}) => {
  const cleaned = cleanPermissionMap(overrides);
  const out = {};
  for (const module of MODULES) {
    if (roleName === SUPER_ADMIN_ROLE) out[module] = [...PERMS];
    else if (hasOwn(cleaned, module)) out[module] = cleaned[module];
    else out[module] = defaultModulePerms(roleName, perms, module);
  }
  return out;
};
const rolePerms = (roleName, perms, module, perm, overrides = {}) => {
  if (roleName === SUPER_ADMIN_ROLE) return true;
  const cleaned = cleanPermissionMap(overrides);
  const list = hasOwn(cleaned, module) ? cleaned[module] : defaultModulePerms(roleName, perms, module);
  return Array.isArray(list) && list.includes(perm);
};

async function enforceDepartmentRole(user, role) {
  if (SUPER_ROLES.has(role.name) || !String(user.department || "").trim()) return null;
  try {
    const department = await db.one(
      "SELECT id, name, active, allowed_role_ids FROM departments WHERE lower(name) = lower($1)",
      [String(user.department).trim()],
    );
    if (!department) return null;
    if (!department.active) throw new HttpError(403, "Your department is disabled");
    const allowed = Array.isArray(department.allowed_role_ids) ? department.allowed_role_ids.map(Number) : [];
    if (allowed.length && !allowed.includes(Number(role.id)))
      throw new HttpError(403, `Your role is not enabled for the ${department.name} department`);
    return department;
  } catch (e) {
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
    try { payload = verifyJwt(token); } catch { throw new HttpError(401, "Invalid or expired token"); }
    if (payload.type !== "access") throw new HttpError(401, "Invalid token type");

    await ensureAccessLevelSchema();
    const user = await db.one("SELECT * FROM users WHERE id = $1", [Number(payload.sub)]);
    if (!user || !user.active || user.deleted_at) throw new HttpError(401, "Account is disabled");
    const role = await db.one("SELECT * FROM roles WHERE id = $1", [user.role_id]);
    if (!role) throw new HttpError(403, "Role missing");
    const accessLevel = effectiveAccessLevel(user, role.name);
    if (!isValidAccessLevel(accessLevel)) throw new HttpError(403, "Access level is not configured");
    const department = await enforceDepartmentRole(user, role);

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
    if (!rolePerms(req.role.name, req.role.perms, module, perm, req.user.permission_overrides || {}))
      return next(new HttpError(403, `Permission denied: ${perm} on ${module}`));
    next();
  }];
}

// ---------------- ownership / organizational scope ----------------
// Only L1/L2 are globally wide. Department Heads are wide only inside their
// own department and Team Leads only inside their own team; ensureRow applies
// that scope through scopedUserIds().
const isWide = (role) => SUPER_ROLES.has(role.name);

/** Legacy list helpers still use this for self-scoped routes. Step-4 read
 * routers add department/team list scope where needed. */
const applyOwnership = (req, column) =>
  isWide(req.role) ? { sql: "", params: [] } : { sql: ` AND ${column} = $`, params: [req.user.id] };

async function ensureRow(req, table, id, ownerColumn) {
  const row = await db.one(`SELECT * FROM ${table} WHERE id = $1`, [id]);
  const gone = !row || row.deleted_at;
  if (gone) throw new HttpError(404, "Record not found");
  if (!ownerColumn || isWide(req.role)) return row;

  const ownerId = Number(row[ownerColumn]);
  const visibleIds = await scopedUserIds(req);
  if (!Number.isInteger(ownerId) || !visibleIds?.includes(ownerId))
    throw new HttpError(403, "This record is outside your Workforce OS scope");
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
  hashPassword, verifyPassword, passwordPolicyError, signAccess, signRefresh, verifyJwt, newRefreshHash,
  MODULES, PERMS, SUPER_ROLES, SUPER_ADMIN_ROLE, MODULE_ALIASES,
  cleanPermissionMap, defaultModulePerms, effectivePermissionMap, rolePerms, requireAuth, requirePerm, isWide,
  applyOwnership, ensureLead, ensureCustomer, ensureDeal, ensureFollowup, ensureTask,
  ensureQuotation, ensureInvoice,
};
