/**
 * Read-only production integrity audit for employee authentication and the
 * canonical Workforce OS department/role model. This never logs PII.
 */
const { db } = require("./db");

async function workforceIntegritySummary() {
  const counts = await db.one(`
    SELECT
      (SELECT COUNT(*)::int FROM users WHERE deleted_at IS NULL AND active=TRUE) AS active_users,
      (SELECT COUNT(*)::int FROM users WHERE deleted_at IS NULL AND active=FALSE) AS disabled_users,
      (SELECT COUNT(*)::int
         FROM users u LEFT JOIN roles r ON r.id=u.role_id
        WHERE u.deleted_at IS NULL AND u.active=TRUE AND r.id IS NULL) AS users_missing_role,
      (SELECT COUNT(*)::int
         FROM users u JOIN roles r ON r.id=u.role_id
        WHERE u.deleted_at IS NULL AND u.active=TRUE
          AND COALESCE(r.assignment_enabled,FALSE)=FALSE) AS users_on_retired_role,
      (SELECT COUNT(*)::int
         FROM users u
         JOIN roles r ON r.id=u.role_id AND r.workforce_role=TRUE
         LEFT JOIN departments d ON d.system=TRUE AND d.system_key=r.department_key
        WHERE u.deleted_at IS NULL AND u.active=TRUE
          AND (d.id IS NULL OR d.active=FALSE
               OR lower(trim(COALESCE(u.department,''))) <> lower(trim(COALESCE(d.name,''))))) AS workforce_department_mismatch,
      (SELECT COUNT(*)::int
         FROM users u JOIN roles r ON r.id=u.role_id AND r.workforce_role=TRUE
        WHERE u.deleted_at IS NULL AND u.active=TRUE
          AND u.access_level IS DISTINCT FROM r.access_level) AS workforce_level_mismatch,
      (SELECT COUNT(*)::int FROM (
         SELECT lower(trim(email)) FROM users
          WHERE deleted_at IS NULL
          GROUP BY lower(trim(email)) HAVING COUNT(*) > 1
       ) x) AS duplicate_email_groups,
      (SELECT COUNT(*)::int FROM departments WHERE system=TRUE AND active=TRUE) AS active_system_departments,
      (SELECT COUNT(*)::int FROM roles WHERE workforce_role=TRUE AND assignment_enabled=TRUE) AS active_workforce_roles,
      (SELECT COUNT(*)::int
         FROM roles r
         LEFT JOIN departments d
           ON d.system=TRUE AND d.system_key=r.department_key AND d.active=TRUE
        WHERE r.workforce_role=TRUE AND r.assignment_enabled=TRUE AND d.id IS NULL) AS workforce_roles_without_active_department,
      (SELECT COUNT(*)::int
         FROM users u JOIN roles r ON r.id=u.role_id
        WHERE u.deleted_at IS NULL AND u.active=TRUE
          AND ((lower(trim(r.name))='super admin' AND u.access_level<>1)
            OR (lower(trim(r.name))='admin' AND u.access_level<>2))) AS global_admin_level_mismatch
  `);

  const out = Object.fromEntries(Object.entries(counts || {}).map(([k,v]) => [k, Number(v || 0)]));
  out.expected_system_departments = 14;
  out.expected_workforce_roles = 56;
  out.healthy =
    out.active_system_departments === out.expected_system_departments &&
    out.active_workforce_roles === out.expected_workforce_roles &&
    out.users_missing_role === 0 &&
    out.workforce_department_mismatch === 0 &&
    out.workforce_level_mismatch === 0 &&
    out.duplicate_email_groups === 0 &&
    out.workforce_roles_without_active_department === 0 &&
    out.global_admin_level_mismatch === 0;
  return out;
}

module.exports = { workforceIntegritySummary };
