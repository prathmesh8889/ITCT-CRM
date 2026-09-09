/**
 * Safe demo Workforce dataset used to understand department + access-level scope.
 *
 * Creates exactly six NON-LOGIN demo employees for each of the 14 approved
 * departments:
 *   L3: 1 HOD, L4: 1 Team Lead, L5: 2 Employees, L6: 2 Interns.
 *
 * The demo identities are deliberately disabled (`active = false`) and use the
 * reserved `.invalid` email domain plus an unknown random password hash, so
 * they cannot sign in to production. They still appear in Departments/Teams so
 * the organizational hierarchy, role function and data scope are easy to see.
 */
const crypto = require("crypto");
const { db } = require("./db");
const { hashPassword } = require("./security");
const { ensureAuthSchema } = require("./auth-schema");
const { ensureAccessLevelSchema } = require("./access-levels");
const { ensureOrganizationSchema } = require("./organization-schema");
const { ensureWorkforceRoleSchema } = require("./workforce-role-schema");
const { ensureTeamSchema } = require("./team-schema");
const { WORKFORCE_ROLES } = require("./workforce-roles");

const DEMO_MARKER_KEY = "workforce_demo_v1";
const DEMO_DOMAIN = "workforce.invalid";
const COPIES_BY_LEVEL = Object.freeze({ 3: 1, 4: 1, 5: 2, 6: 2 });
const COLOR_BY_LEVEL = Object.freeze({ 3: "#7C3AED", 4: "#0F766E", 5: "#2563EB", 6: "#D97706" });

function buildDemoWorkforcePlan(roles = WORKFORCE_ROLES) {
  const plan = [];
  for (const role of roles) {
    const copies = Number(COPIES_BY_LEVEL[role.level] || 0);
    for (let i = 0; i < copies; i += 1) {
      const duplicateSuffix = copies > 1 ? ` ${i + 1}` : "";
      const emailSuffix = copies > 1 ? String.fromCharCode(97 + i) : "";
      plan.push({
        department_key: role.department_key,
        department: role.department,
        level: role.level,
        role_title: role.title,
        primary_function: role.primary_function,
        slot: i + 1,
        name: `DEMO · ${role.title}${duplicateSuffix}`,
        email: `demo.${role.department_key}.l${role.level}${emailSuffix}@${DEMO_DOMAIN}`,
        color: COLOR_BY_LEVEL[role.level] || "#0F766E",
      });
    }
  }
  return plan;
}

function groupByDepartment(plan) {
  const grouped = new Map();
  for (const row of plan) {
    const list = grouped.get(row.department_key) || [];
    list.push(row);
    grouped.set(row.department_key, list);
  }
  return grouped;
}

async function seedDemoWorkforce() {
  await ensureAuthSchema();
  await ensureAccessLevelSchema();
  await ensureOrganizationSchema();
  await ensureWorkforceRoleSchema();
  await ensureTeamSchema();

  const plan = buildDemoWorkforcePlan();
  const expectedEmployees = plan.length;
  const expectedDepartments = new Set(plan.map((x) => x.department_key)).size;

  const marker = await db.one("SELECT value FROM crm_settings WHERE key = $1", [DEMO_MARKER_KEY]);
  if (marker?.value?.version === 1) {
    const existing = await db.one(
      "SELECT COUNT(*)::int AS n FROM users WHERE deleted_at IS NULL AND lower(email) LIKE $1",
      [`demo.%@${DEMO_DOMAIN}`],
    );
    if (Number(existing?.n || 0) === expectedEmployees) {
      return { ...marker.value, skipped: true };
    }
  }

  const owner = await db.one(`
    SELECT u.id
      FROM users u
      JOIN roles r ON r.id = u.role_id
     WHERE u.deleted_at IS NULL AND lower(trim(r.name)) = 'super admin'
     ORDER BY u.id
     LIMIT 1
  `);
  const ownerId = owner ? Number(owner.id) : null;
  const disabledPasswordHash = hashPassword(crypto.randomBytes(48).toString("base64url"));
  const grouped = groupByDepartment(plan);

  await db.tx(async (client) => {
    for (const [departmentKey, members] of grouped.entries()) {
      const department = (await client.query(
        "SELECT id, name FROM departments WHERE system = TRUE AND system_key = $1",
        [departmentKey],
      )).rows[0];
      if (!department) throw new Error(`Approved department missing: ${departmentKey}`);

      const teamName = `DEMO · ${department.name} Core Team`;
      const team = (await client.query(
        `INSERT INTO teams (name, focus, department, active, created_by, updated_at)
         VALUES ($1,$2,$3,TRUE,$4,now())
         ON CONFLICT (name) DO UPDATE SET
           focus = EXCLUDED.focus,
           department = EXCLUDED.department,
           active = TRUE,
           updated_at = now()
         RETURNING id`,
        [teamName, "Demo team for L4 team-scope and L5/L6 individual-scope visualization", department.name, ownerId],
      )).rows[0];

      const roleRows = (await client.query(
        `SELECT id, name, access_level
           FROM roles
          WHERE workforce_role = TRUE
            AND assignment_enabled = TRUE
            AND department_key = $1`,
        [departmentKey],
      )).rows;
      const roleByName = new Map(roleRows.map((r) => [String(r.name).toLowerCase(), r]));

      let hodId = null;
      let teamLeadId = null;
      const ordered = [...members].sort((a, b) => a.level - b.level || a.slot - b.slot);

      for (const member of ordered) {
        const role = roleByName.get(String(member.role_title).toLowerCase());
        if (!role) throw new Error(`Approved role missing: ${member.role_title}`);

        const reportingManagerId = member.level === 4
          ? hodId
          : member.level >= 5
            ? teamLeadId
            : null;
        const teamId = member.level >= 4 ? Number(team.id) : null;
        const isSales = departmentKey === "sales-business-development";

        const user = (await client.query(
          `INSERT INTO users
             (name, email, phone, password_hash, department, designation, role_id,
              team_id, reporting_manager_id, joining_date, is_sales, active,
              color, access_level, must_change_password, deleted_at, last_login_at)
           VALUES ($1,$2,'',$3,$4,$5,$6,$7,$8,$9,$10,FALSE,$11,$12,TRUE,NULL,NULL)
           ON CONFLICT (email) DO UPDATE SET
             name = EXCLUDED.name,
             phone = '',
             password_hash = EXCLUDED.password_hash,
             department = EXCLUDED.department,
             designation = EXCLUDED.designation,
             role_id = EXCLUDED.role_id,
             team_id = EXCLUDED.team_id,
             reporting_manager_id = EXCLUDED.reporting_manager_id,
             joining_date = EXCLUDED.joining_date,
             is_sales = EXCLUDED.is_sales,
             active = FALSE,
             color = EXCLUDED.color,
             access_level = EXCLUDED.access_level,
             must_change_password = TRUE,
             deleted_at = NULL,
             last_login_at = NULL
           RETURNING id`,
          [
            member.name,
            member.email,
            disabledPasswordHash,
            department.name,
            member.role_title,
            Number(role.id),
            teamId,
            reportingManagerId,
            "2026-01-01",
            isSales,
            member.color,
            Number(member.level),
          ],
        )).rows[0];

        if (member.level === 3) hodId = Number(user.id);
        if (member.level === 4) teamLeadId = Number(user.id);
      }

      await client.query(
        "UPDATE teams SET lead_user_id = $1, updated_at = now() WHERE id = $2",
        [teamLeadId, Number(team.id)],
      );
    }
  });

  const summary = {
    version: 1,
    seeded_at: new Date().toISOString(),
    departments: expectedDepartments,
    employees: expectedEmployees,
    employees_per_department: 6,
    distribution: { L3: 1, L4: 1, L5: 2, L6: 2 },
    login_enabled: false,
    note: "Demo-only disabled identities for Workforce OS hierarchy visualization",
  };

  await db.query(
    `INSERT INTO crm_settings (key, value) VALUES ($1,$2::jsonb)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [DEMO_MARKER_KEY, JSON.stringify(summary)],
  );

  return { ...summary, skipped: false };
}

if (require.main === module) {
  seedDemoWorkforce()
    .then((result) => { console.log("[demo-workforce]", JSON.stringify(result)); return db.end(); })
    .then(() => process.exit(0))
    .catch(async (error) => {
      console.error("[demo-workforce] FAILED:", error.message);
      try { await db.end(); } catch {}
      process.exit(1);
    });
}

module.exports = { DEMO_DOMAIN, COPIES_BY_LEVEL, buildDemoWorkforcePlan, seedDemoWorkforce };
