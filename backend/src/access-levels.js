/** Organizational access-level foundation for ITCYBER Workforce OS / CRM.
 * Approved L3-L6 Workforce roles bind one canonical department + level; legacy
 * role inference remains only for backward-compatible accounts.
 */
const { db } = require("./db");

const ACCESS_LEVELS = Object.freeze([
  Object.freeze({ level: 1, code: "L1", name: "Super Admin / CEO", scope: "Global Control", data_visibility: "Full organization, strategic KPIs and financial visibility", summary: "Highest organizational authority and global control." }),
  Object.freeze({ level: 2, code: "L2", name: "Operational Admin / COO", scope: "Global Operations", data_visibility: "Cross-department operations, utilization, SLA and performance visibility", summary: "Runs company-wide operations below the CEO layer." }),
  Object.freeze({ level: 3, code: "L3", name: "Department Head / HOD", scope: "Department Ownership", data_visibility: "Only the assigned department and its subordinate work", summary: "Owns one department and its routine decisions." }),
  Object.freeze({ level: 4, code: "L4", name: "Team Lead", scope: "Team Workspace", data_visibility: "Only the assigned team, daily execution and task visibility", summary: "Owns execution for an assigned team." }),
  Object.freeze({ level: 5, code: "L5", name: "Full-Time Employee", scope: "Individual Workspace", data_visibility: "Own tasks, assigned CRM records and personal KPIs", summary: "Individual execution layer." }),
  Object.freeze({ level: 6, code: "L6", name: "Intern", scope: "Restricted / Sandbox", data_visibility: "Restricted task workspace with masked PII and bulk export blocked", summary: "Lowest-trust supervised learning and support layer." }),
]);

const isValidAccessLevel = (value) => {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= 6;
};

function inferAccessLevelFromRole(roleName) {
  const name = String(roleName || "").trim().toLowerCase();
  if (name === "super admin" || name === "ceo") return 1;
  if (["admin", "operational admin", "coo", "operations head"].includes(name)) return 2;
  if (name.includes("intern")) return 6;
  if (name.includes("team lead") || name.includes("team leader")) return 4;
  if (name.includes("manager") || name.includes("department head") || name.includes("hod")) return 3;
  return 5;
}

function effectiveAccessLevel(user, roleName = "") {
  if (isValidAccessLevel(user?.access_level)) return Number(user.access_level);
  return inferAccessLevelFromRole(roleName);
}

function canAssignAccessLevel(actorLevel, nextLevel, { sameDepartment = false } = {}) {
  const actor = Number(actorLevel);
  const next = Number(nextLevel);
  if (!isValidAccessLevel(actor) || !isValidAccessLevel(next)) return false;
  if (actor === 1) return true;
  if (actor === 2) return next > 2;
  if (actor === 3) return sameDepartment && next > 3;
  return false;
}

function canManageAccessLevel(actorLevel, targetLevel, nextLevel, opts = {}) {
  const actor = Number(actorLevel);
  const target = Number(targetLevel);
  if (!canAssignAccessLevel(actor, nextLevel, opts)) return false;
  if (!Number.isInteger(target) || target < 1 || target > 6) return false;
  return actor === 1 || target > actor;
}

let ready = null;
function ensureAccessLevelSchema() {
  if (!ready) {
    ready = (async () => {
      await db.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS access_level SMALLINT");
      await db.query(`
        UPDATE users u
           SET access_level = CASE
             WHEN lower(trim(r.name)) IN ('super admin','ceo') THEN 1
             WHEN lower(trim(r.name)) IN ('admin','operational admin','coo','operations head') THEN 2
             WHEN lower(trim(r.name)) LIKE '%intern%' THEN 6
             WHEN lower(trim(r.name)) LIKE '%team lead%' OR lower(trim(r.name)) LIKE '%team leader%' THEN 4
             WHEN lower(trim(r.name)) LIKE '%manager%' OR lower(trim(r.name)) LIKE '%department head%' OR lower(trim(r.name)) LIKE '%hod%' THEN 3
             ELSE 5
           END
          FROM roles r
         WHERE u.role_id = r.id
           AND (u.access_level IS NULL OR u.access_level NOT BETWEEN 1 AND 6)
      `);
      await db.query("UPDATE users SET access_level = 5 WHERE access_level IS NULL OR access_level NOT BETWEEN 1 AND 6");
      await db.query(`
        UPDATE users u SET access_level = 1
          FROM roles r
         WHERE u.role_id = r.id AND lower(trim(r.name)) = 'super admin' AND u.access_level <> 1
      `);
      await db.query(`
        UPDATE users u SET access_level = 2
          FROM roles r
         WHERE u.role_id = r.id AND lower(trim(r.name)) = 'admin' AND u.access_level <> 2
      `);
      await db.query(`
        ALTER TABLE users ALTER COLUMN access_level SET DEFAULT 5;
        ALTER TABLE users ALTER COLUMN access_level SET NOT NULL
      `);
      await db.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_users_access_level') THEN
            ALTER TABLE users ADD CONSTRAINT ck_users_access_level CHECK (access_level BETWEEN 1 AND 6);
          END IF;
        END $$
      `);
    })().catch((e) => {
      ready = null;
      throw e;
    });
  }
  return ready;
}

module.exports = {
  ACCESS_LEVELS,
  isValidAccessLevel,
  inferAccessLevelFromRole,
  effectiveAccessLevel,
  canAssignAccessLevel,
  canManageAccessLevel,
  ensureAccessLevelSchema,
};
