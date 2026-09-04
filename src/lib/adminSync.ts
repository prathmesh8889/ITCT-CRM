/**
 * Write-through for the Admin modules.
 *
 * Demo mode: admin screens operate on the embedded workspace (mutate()).
 * Production mode: every admin write is ALSO sent to the backend API so the
 * change lands in PostgreSQL. The local store is kept in sync for instant UI.
 *
 * Backend IDs are integers; the UI store holds them as strings (see mappers).
 */
import { DEMO_MODE, userApi, roleApi, teamApi, automationApi } from "./api";
import type { AutomationRule, Role, User } from "./types";

const nid = (id: string): number => parseInt(id, 10);
const ruleBody = (r: Partial<AutomationRule>) => ({
  name: r.name, trigger: r.trigger, cond_field: r.condField || "", cond_op: r.condOp || "eq",
  cond_value: r.condValue || "", actions: r.actions || [], enabled: r.enabled ?? true,
});

export async function syncUserCreate(u: { name: string; email: string; phone: string; password: string; roleId: string; teamId?: string; isSales: boolean }): Promise<void> {
  if (DEMO_MODE) return;
  await userApi.create({ name: u.name, email: u.email, phone: u.phone || "", password: u.password,
    role_id: nid(u.roleId), team_id: u.teamId ? nid(u.teamId) : null,
    department: u.isSales ? "Sales" : "Operations", designation: u.isSales ? "Sales Executive" : "",
    is_sales: u.isSales, active: true });
}

export async function syncUserUpdate(id: string, patch: Partial<User>): Promise<void> {
  if (DEMO_MODE) return;
  const body: Record<string, unknown> = {};
  if (patch.name !== undefined) body.name = patch.name;
  if (patch.roleId !== undefined) body.role_id = nid(patch.roleId);
  if (patch.active !== undefined) body.active = patch.active;
  if (patch.teamId !== undefined) body.team_id = patch.teamId ? nid(patch.teamId) : null;
  if (patch.isSales !== undefined) body.is_sales = patch.isSales;
  if (Object.keys(body).length) await userApi.update(nid(id), body);
}

export async function syncRoleSave(roleId: string, patch: Partial<Role>): Promise<void> {
  if (DEMO_MODE) return;
  const body: Record<string, unknown> = {};
  if (patch.name !== undefined) body.name = patch.name;
  if (patch.description !== undefined) body.description = patch.description;
  if (Object.keys(body).length) await roleApi.update(nid(roleId), body);
}

export async function syncRolePerms(roleId: string, perms: Record<string, string[]>): Promise<void> {
  if (DEMO_MODE) return;
  await roleApi.setPermissions(nid(roleId), perms);
}

export async function syncTeamCreate(t: { name: string; focus: string; memberIds: string[] }): Promise<void> {
  if (DEMO_MODE) return;
  await teamApi.create({ name: t.name, focus: t.focus || "", member_ids: t.memberIds.map(nid) });
}

export async function syncRuleSave(rule: Partial<AutomationRule>, editing: boolean): Promise<void> {
  if (DEMO_MODE) return;
  if (editing && rule.id) await automationApi.updateRule(nid(rule.id), ruleBody(rule));
  else await automationApi.createRule(ruleBody(rule));
}

export async function syncRuleToggle(ruleId: string, enabled: boolean): Promise<void> {
  if (DEMO_MODE) return;
  await automationApi.updateRule(nid(ruleId), { enabled });
}

export async function syncRuleDelete(ruleId: string): Promise<void> {
  if (DEMO_MODE) return;
  await automationApi.removeRule(nid(ruleId));
}
