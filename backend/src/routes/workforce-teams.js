/** Department-scoped Team Management for Workforce OS.
 * L1/L2 can manage every team. L3 can create/edit teams only inside their own
 * department. L4 can view only their own team. Lower levels do not receive
 * team-management permissions.
 */
const express = require("express");
const { db } = require("../db");
const { HttpError } = require("../core");
const { requirePerm } = require("../security");
const { isGlobalAdmin, norm } = require("../workforce-scope");
const { ensureWorkforceRoleSchema } = require("../workforce-role-schema");
const { ensureTeamSchema } = require("../team-schema");

const router = express.Router();

const audit = (req, action, target, detail = "") => db.query(
  "INSERT INTO audit_logs (user_id, user_name, action, target, detail) VALUES ($1,$2,$3,$4,$5)",
  [req.user?.id ?? null, req.user?.name ?? "system", action, target, detail],
);

async function approvedDepartment(name) {
  const department = await db.one(
    "SELECT id, name, system_key, active FROM departments WHERE system = TRUE AND lower(trim(name)) = lower(trim($1))",
    [String(name || "").trim()],
  );
  if (!department || !department.active) throw new HttpError(422, "Select an active approved department");
  return department;
}

function assertDepartmentManager(req, departmentName) {
  if (isGlobalAdmin(req)) return;
  if (Number(req.accessLevel) !== 3)
    throw new HttpError(403, "Only Super Admin/Admin or a Department Head can manage teams");
  if (!norm(req.user.department) || norm(req.user.department) !== norm(departmentName))
    throw new HttpError(403, "Department Head can manage teams only in their own department");
}

async function validatedMemberIds(departmentName, memberIds, leadUserId) {
  const ids = [...new Set((Array.isArray(memberIds) ? memberIds : []).map(Number).filter((x) => Number.isInteger(x) && x > 0))];
  const leadId = leadUserId == null || leadUserId === "" ? null : Number(leadUserId);
  if (leadId && !ids.includes(leadId)) ids.push(leadId);
  if (!ids.length) return { ids: [], leadId };

  const rows = await db.all(
    `SELECT u.id, u.name, u.department, u.access_level, u.team_id, u.active,
            r.name AS role_name, r.access_level AS role_level
       FROM users u LEFT JOIN roles r ON r.id = u.role_id
      WHERE u.deleted_at IS NULL AND u.id = ANY($1::int[])`,
    [ids],
  );
  if (rows.length !== ids.length) throw new HttpError(422, "One or more selected team members no longer exist");
  for (const row of rows) {
    if (!row.active) throw new HttpError(422, `${row.name} is disabled and cannot be assigned to a team`);
    if (norm(row.department) !== norm(departmentName))
      throw new HttpError(422, `${row.name} belongs to another department`);
  }
  if (leadId) {
    const lead = rows.find((x) => Number(x.id) === leadId);
    const level = Number(lead?.role_level || lead?.access_level);
    if (!lead || level !== 4)
      throw new HttpError(422, "Team Lead must be an active L4 employee from the selected department");
  }
  return { ids, leadId };
}

async function teamView(team, global) {
  const members = await db.all(
    `SELECT u.id, u.name, u.email, u.department, u.designation, u.access_level, u.active,
            r.name AS role_name
       FROM users u LEFT JOIN roles r ON r.id = u.role_id
      WHERE u.deleted_at IS NULL AND u.team_id = $1
      ORDER BY u.access_level, u.name`,
    [team.id],
  );
  const lead = team.lead_user_id
    ? members.find((m) => Number(m.id) === Number(team.lead_user_id))
      || await db.one("SELECT id, name, email, department, designation, access_level FROM users WHERE id = $1 AND deleted_at IS NULL", [team.lead_user_id])
    : null;
  return {
    ...team,
    member_ids: members.map((m) => m.id),
    member_count: members.length,
    lead: lead ? { id: lead.id, name: lead.name, email: lead.email, designation: lead.designation, access_level: lead.access_level } : null,
    members: global ? members : members.map((m) => ({ ...m, email: m.email })),
  };
}

router.get("/teams", requirePerm("teams", "view"), async (req, res, next) => {
  try {
    await ensureWorkforceRoleSchema();
    await ensureTeamSchema();
    let teams;
    if (isGlobalAdmin(req)) {
      teams = await db.all("SELECT * FROM teams WHERE active = TRUE ORDER BY department, name");
    } else if (Number(req.accessLevel) === 3) {
      teams = await db.all(
        "SELECT * FROM teams WHERE active = TRUE AND lower(trim(department)) = lower(trim($1)) ORDER BY name",
        [req.user.department],
      );
    } else if (Number(req.accessLevel) === 4 && req.user.team_id) {
      teams = await db.all("SELECT * FROM teams WHERE active = TRUE AND id = $1", [req.user.team_id]);
    } else {
      teams = [];
    }
    res.json(await Promise.all(teams.map((t) => teamView(t, isGlobalAdmin(req)))));
  } catch (e) { next(e); }
});

router.post("/teams", requirePerm("teams", "create"), async (req, res, next) => {
  try {
    await ensureWorkforceRoleSchema();
    await ensureTeamSchema();
    const b = req.body || {};
    const name = String(b.name || "").trim();
    const focus = String(b.focus || "").trim();
    if (!name) throw new HttpError(422, "Team name is required");

    const requestedDepartment = isGlobalAdmin(req) ? String(b.department || "").trim() : String(req.user.department || "").trim();
    const department = await approvedDepartment(requestedDepartment);
    assertDepartmentManager(req, department.name);
    if (await db.one("SELECT id FROM teams WHERE lower(trim(name)) = lower(trim($1))", [name]))
      throw new HttpError(409, "A team with this name already exists");

    const { ids, leadId } = await validatedMemberIds(department.name, b.member_ids, b.lead_user_id);
    if (ids.length) {
      const assigned = await db.all(
        "SELECT id, name, team_id FROM users WHERE id = ANY($1::int[]) AND team_id IS NOT NULL",
        [ids],
      );
      if (assigned.length)
        throw new HttpError(409, `${assigned[0].name} is already assigned to another team. Remove or move them first`);
    }

    const result = await db.tx(async (c) => {
      const r = await c.query(
        `INSERT INTO teams (name, focus, department, lead_user_id, active, created_by, updated_at)
         VALUES ($1,$2,$3,$4,TRUE,$5,now()) RETURNING *`,
        [name, focus, department.name, leadId, req.user.id],
      );
      const team = r.rows[0];
      if (ids.length) await c.query("UPDATE users SET team_id = $1 WHERE id = ANY($2::int[])", [team.id, ids]);
      return team;
    });
    await audit(req, "Team Created", `team:${result.name}`, `${department.name}; ${ids.length} member(s)`);
    res.status(201).json(await teamView(result, isGlobalAdmin(req)));
  } catch (e) { next(e); }
});

router.patch("/teams/:id", requirePerm("teams", "edit"), async (req, res, next) => {
  try {
    await ensureWorkforceRoleSchema();
    await ensureTeamSchema();
    const id = Number(req.params.id);
    const current = await db.one("SELECT * FROM teams WHERE id = $1 AND active = TRUE", [id]);
    if (!current) throw new HttpError(404, "Team not found");
    assertDepartmentManager(req, current.department);

    const b = req.body || {};
    const nextDepartmentName = isGlobalAdmin(req) && b.department !== undefined
      ? String(b.department || "").trim()
      : current.department;
    const department = await approvedDepartment(nextDepartmentName);
    assertDepartmentManager(req, department.name);
    const name = b.name !== undefined ? String(b.name).trim() : current.name;
    const focus = b.focus !== undefined ? String(b.focus || "").trim() : current.focus;
    if (!name) throw new HttpError(422, "Team name is required");
    if (await db.one("SELECT id FROM teams WHERE lower(trim(name)) = lower(trim($1)) AND id <> $2", [name, id]))
      throw new HttpError(409, "A team with this name already exists");

    let ids = null;
    let leadId = b.lead_user_id !== undefined ? b.lead_user_id : current.lead_user_id;
    if (Array.isArray(b.member_ids) || b.lead_user_id !== undefined || norm(department.name) !== norm(current.department)) {
      const existing = Array.isArray(b.member_ids)
        ? b.member_ids
        : (await db.all("SELECT id FROM users WHERE team_id = $1 AND deleted_at IS NULL", [id])).map((x) => x.id);
      const validated = await validatedMemberIds(department.name, existing, leadId);
      ids = validated.ids;
      leadId = validated.leadId;
      if (ids.length) {
        const assigned = await db.all(
          "SELECT id, name, team_id FROM users WHERE id = ANY($1::int[]) AND team_id IS NOT NULL AND team_id <> $2",
          [ids, id],
        );
        if (assigned.length)
          throw new HttpError(409, `${assigned[0].name} is already assigned to another team`);
      }
    }

    const updated = await db.tx(async (c) => {
      await c.query(
        `UPDATE teams SET name=$1, focus=$2, department=$3, lead_user_id=$4, updated_at=now() WHERE id=$5`,
        [name, focus, department.name, leadId || null, id],
      );
      if (ids) {
        await c.query("UPDATE users SET team_id = NULL WHERE team_id = $1", [id]);
        if (ids.length) await c.query("UPDATE users SET team_id = $1 WHERE id = ANY($2::int[])", [id, ids]);
      }
      return (await c.query("SELECT * FROM teams WHERE id = $1", [id])).rows[0];
    });
    await audit(req, "Team Updated", `team:${updated.name}`, `${department.name}`);
    res.json(await teamView(updated, isGlobalAdmin(req)));
  } catch (e) { next(e); }
});

module.exports = router;
