/**
 * Workforce OS demo dataset for department/level training.
 *
 * Creates six demo employees in each approved department:
 *   L3: 1 HOD, L4: 1 Team Lead, L5: 2 Employees, L6: 2 Interns.
 *
 * L3/HOD accounts can sign in only when DEMO_HOD_PASSWORD is configured.
 * Other demo members are active so they appear in real scope/assignment queries,
 * but retain an unknown random password and are not intended for sign-in.
 */
const crypto = require("crypto");
const { db } = require("./db");
const { hashPassword } = require("./security");
const { ensureAuthSchema } = require("./auth-schema");
const { ensureAccessLevelSchema } = require("./access-levels");
const { ensureOrganizationSchema } = require("./organization-schema");
const { ensureWorkforceRoleSchema } = require("./workforce-role-schema");
const { ensureTeamSchema } = require("./team-schema");
const { ensureWorkforceDomainSchema } = require("./workforce-domain-schema");
const { WORKFORCE_ROLES } = require("./workforce-roles");

const DEMO_MARKER_KEY = "workforce_demo_v1";
const DEMO_DOMAIN = "workforce.invalid";
const DEMO_VERSION = 2;
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

function isoAfter(days) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + Number(days || 0));
  return date.toISOString().slice(0, 10);
}

function demoTask(member, departmentName) {
  if (member.level === 3) return {
    title: `Review ${departmentName} KPIs and team output`, priority: "High", status: "In Progress", due: isoAfter(3),
  };
  if (member.level === 4) return {
    title: `Coordinate ${departmentName} daily team execution`, priority: "High", status: "In Progress", due: isoAfter(2),
  };
  if (member.level === 5) return {
    title: `${member.role_title}: execute work package ${member.slot}`, priority: "Medium",
    status: member.slot === 1 ? "In Progress" : "Pending", due: isoAfter(7 + member.slot),
  };
  return {
    title: `${member.role_title}: supervised learning task ${member.slot}`, priority: "Low", status: "Pending", due: isoAfter(5 + member.slot),
  };
}

async function seedDemoWorkforce() {
  await ensureAuthSchema();
  await ensureAccessLevelSchema();
  await ensureOrganizationSchema();
  await ensureWorkforceRoleSchema();
  await ensureTeamSchema();
  await ensureWorkforceDomainSchema();

  const hodPassword = String(process.env.DEMO_HOD_PASSWORD || "");
  const plan = buildDemoWorkforcePlan();
  const expectedEmployees = plan.length;
  const expectedDepartments = new Set(plan.map((x) => x.department_key)).size;
  const marker = await db.one("SELECT value FROM crm_settings WHERE key = $1", [DEMO_MARKER_KEY]);
  const existing = await db.one(
    "SELECT COUNT(*)::int AS n FROM users WHERE deleted_at IS NULL AND lower(email) LIKE $1",
    [`demo.%@${DEMO_DOMAIN}`],
  );

  // Keep HOD credentials synchronized to the Railway secret even on later boots.
  if (marker?.value?.version === DEMO_VERSION && Number(existing?.n || 0) === expectedEmployees) {
    if (hodPassword) {
      const hodHash = hashPassword(hodPassword);
      await db.query(
        `UPDATE users SET password_hash=$1,active=TRUE,must_change_password=FALSE
          WHERE deleted_at IS NULL AND lower(email) LIKE $2`,
        [hodHash, `demo.%.l3@${DEMO_DOMAIN}`],
      );
    }
    await db.query(
      `UPDATE users SET active=TRUE
        WHERE deleted_at IS NULL AND lower(email) LIKE $1`,
      [`demo.%@${DEMO_DOMAIN}`],
    );
    return { ...marker.value, login_enabled: !!hodPassword, skipped: true };
  }

  const owner = await db.one(`
    SELECT u.id
      FROM users u
      JOIN roles r ON r.id = u.role_id
     WHERE u.deleted_at IS NULL AND lower(trim(r.name)) = 'super admin'
     ORDER BY u.id LIMIT 1
  `);
  const ownerId = owner ? Number(owner.id) : null;
  const randomPasswordHash = hashPassword(crypto.randomBytes(48).toString("base64url"));
  const hodPasswordHash = hodPassword ? hashPassword(hodPassword) : randomPasswordHash;
  const grouped = groupByDepartment(plan);

  await db.tx(async (client) => {
    for (const [departmentKey, members] of grouped.entries()) {
      const department = (await client.query(
        "SELECT id,name FROM departments WHERE system=TRUE AND system_key=$1",
        [departmentKey],
      )).rows[0];
      if (!department) throw new Error(`Approved department missing: ${departmentKey}`);

      const teamName = `DEMO · ${department.name} Core Team`;
      const team = (await client.query(
        `INSERT INTO teams (name,focus,department,active,created_by,updated_at)
         VALUES ($1,$2,$3,TRUE,$4,now())
         ON CONFLICT (name) DO UPDATE SET focus=EXCLUDED.focus,department=EXCLUDED.department,
           active=TRUE,updated_at=now() RETURNING id`,
        [teamName, "Demo team for Workforce OS hierarchy and work-scope training", department.name, ownerId],
      )).rows[0];

      const roleRows = (await client.query(
        `SELECT id,name,access_level FROM roles
          WHERE workforce_role=TRUE AND assignment_enabled=TRUE AND department_key=$1`,
        [departmentKey],
      )).rows;
      const roleByName = new Map(roleRows.map((r) => [String(r.name).toLowerCase(), r]));

      let hodId = null;
      let teamLeadId = null;
      const created = [];
      const ordered = [...members].sort((a, b) => a.level - b.level || a.slot - b.slot);

      for (const member of ordered) {
        const role = roleByName.get(String(member.role_title).toLowerCase());
        if (!role) throw new Error(`Approved role missing: ${member.role_title}`);
        const reportingManagerId = member.level === 4 ? hodId : member.level >= 5 ? teamLeadId : null;
        const teamId = member.level >= 4 ? Number(team.id) : null;
        const isSales = departmentKey === "sales-business-development";
        const isHod = member.level === 3;

        const user = (await client.query(
          `INSERT INTO users
             (name,email,phone,password_hash,department,designation,role_id,team_id,
              reporting_manager_id,joining_date,is_sales,active,color,access_level,
              must_change_password,deleted_at,last_login_at)
           VALUES ($1,$2,'',$3,$4,$5,$6,$7,$8,$9,$10,TRUE,$11,$12,$13,NULL,NULL)
           ON CONFLICT (email) DO UPDATE SET
             name=EXCLUDED.name,phone='',password_hash=EXCLUDED.password_hash,
             department=EXCLUDED.department,designation=EXCLUDED.designation,role_id=EXCLUDED.role_id,
             team_id=EXCLUDED.team_id,reporting_manager_id=EXCLUDED.reporting_manager_id,
             joining_date=EXCLUDED.joining_date,is_sales=EXCLUDED.is_sales,active=TRUE,
             color=EXCLUDED.color,access_level=EXCLUDED.access_level,
             must_change_password=EXCLUDED.must_change_password,deleted_at=NULL,last_login_at=NULL
           RETURNING id`,
          [member.name, member.email, isHod ? hodPasswordHash : randomPasswordHash,
           department.name, member.role_title, Number(role.id), teamId, reportingManagerId,
           "2026-01-01", isSales, member.color, Number(member.level), !isHod],
        )).rows[0];

        const entry = { ...member, user_id: Number(user.id) };
        created.push(entry);
        if (member.level === 3) hodId = entry.user_id;
        if (member.level === 4) teamLeadId = entry.user_id;
      }

      await client.query("UPDATE teams SET lead_user_id=$1,updated_at=now() WHERE id=$2", [teamLeadId, Number(team.id)]);

      const memberIds = created.map((x) => x.user_id);
      await client.query(
        "DELETE FROM tasks WHERE assigned_to_id=ANY($1::int[]) AND description LIKE '[WORKFORCE DEMO]%'",
        [memberIds],
      );
      for (const member of created) {
        const task = demoTask(member, department.name);
        await client.query(
          `INSERT INTO tasks
             (title,description,assigned_to_id,created_by_id,priority,status,due_date)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [task.title, `[WORKFORCE DEMO] ${member.primary_function}`, member.user_id, hodId,
           task.priority, task.status, task.due],
        );
      }

      for (const member of created.filter((x) => x.level === 5)) {
        const projectCode = `DEMO-${departmentKey.replace(/[^a-z0-9]+/gi, "-").toUpperCase()}-L5-${member.slot}`;
        const progress = member.slot === 1 ? 45 : 70;
        await client.query(
          `INSERT INTO workforce_projects
             (project_code,name,description,department_key,project_manager_id,assigned_employee_id,
              status,progress,start_date,due_date,last_update,created_by,updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,'In Progress',$7,$8,$9,$10,$5,now())
           ON CONFLICT (project_code) DO UPDATE SET
             name=EXCLUDED.name,description=EXCLUDED.description,department_key=EXCLUDED.department_key,
             project_manager_id=EXCLUDED.project_manager_id,assigned_employee_id=EXCLUDED.assigned_employee_id,
             status=EXCLUDED.status,progress=EXCLUDED.progress,start_date=EXCLUDED.start_date,
             due_date=EXCLUDED.due_date,last_update=EXCLUDED.last_update,updated_at=now()`,
          [projectCode, `Demo ${department.name} Workstream ${member.slot}`,
           `[WORKFORCE DEMO] ${member.primary_function}`, departmentKey, hodId, member.user_id,
           progress, isoAfter(0), isoAfter(14 + member.slot * 7),
           `Current demo progress: ${progress}% · review with department HOD.`],
        );
      }
    }
  });

  const summary = {
    version: DEMO_VERSION,
    seeded_at: new Date().toISOString(),
    departments: expectedDepartments,
    employees: expectedEmployees,
    employees_per_department: 6,
    distribution: { L3: 1, L4: 1, L5: 2, L6: 2 },
    hod_logins: 14,
    tasks: 84,
    projects: 28,
    login_enabled: !!hodPassword,
    note: "L3 HOD demo logins are enabled by server secret; every department contains visible demo work.",
  };
  await db.query(
    `INSERT INTO crm_settings (key,value) VALUES ($1,$2::jsonb)
     ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value`,
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

module.exports = { DEMO_DOMAIN, DEMO_VERSION, COPIES_BY_LEVEL, buildDemoWorkforcePlan, demoTask, seedDemoWorkforce };
