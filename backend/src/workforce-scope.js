/** Central Workforce OS scope helpers.
 * L1/L2: global. L3: own department. L4: own team. L5/L6: self.
 */
const { db } = require("./db");
const { HttpError } = require("./core");

const norm = (v) => String(v || "").trim().toLowerCase();
const isGlobalAdmin = (req) => ["Super Admin", "Admin"].includes(String(req?.role?.name || ""));

function scopeMode(req) {
  if (isGlobalAdmin(req)) return "global";
  const level = Number(req?.accessLevel || req?.user?.access_level || 6);
  if (level === 3) return "department";
  if (level === 4) return req?.user?.team_id ? "team" : "self";
  return "self";
}

async function scopedUserIds(req) {
  const mode = scopeMode(req);
  if (mode === "global") return null;
  if (mode === "department") {
    if (!norm(req.user.department)) return [Number(req.user.id)];
    const rows = await db.all(
      "SELECT id FROM users WHERE deleted_at IS NULL AND lower(trim(COALESCE(department,''))) = lower(trim($1))",
      [req.user.department],
    );
    return rows.map((x) => Number(x.id));
  }
  if (mode === "team") {
    const rows = await db.all(
      `SELECT id FROM users
        WHERE deleted_at IS NULL AND team_id = $1
          AND lower(trim(COALESCE(department,''))) = lower(trim($2))`,
      [req.user.team_id, req.user.department || ""],
    );
    return rows.map((x) => Number(x.id));
  }
  return [Number(req.user.id)];
}

function canSeeDepartment(req, departmentName) {
  if (isGlobalAdmin(req)) return true;
  return !!norm(req.user.department) && norm(req.user.department) === norm(departmentName);
}

function assertDepartment(req, departmentName) {
  if (!canSeeDepartment(req, departmentName))
    throw new HttpError(403, "You can access only your assigned department");
}

function canManageTarget(req, target) {
  if (isGlobalAdmin(req)) return true;
  const level = Number(req.accessLevel || 6);
  if (level === 3) return norm(req.user.department) && norm(req.user.department) === norm(target.department);
  if (level === 4) return !!req.user.team_id && Number(req.user.team_id) === Number(target.team_id)
    && norm(req.user.department) === norm(target.department);
  return Number(req.user.id) === Number(target.id);
}

module.exports = { norm, isGlobalAdmin, scopeMode, scopedUserIds, canSeeDepartment, assertDepartment, canManageTarget };
