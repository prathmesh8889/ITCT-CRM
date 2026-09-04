import { useMemo, useState } from "react";
import { Plus, Pencil, Shield, Users, Zap, Search, Trash2, Check } from "lucide-react";
import { useStore } from "../store";
import { mutate, useDB, uid, hashPass } from "../lib/db";
import { logAudit, fmtDT, runTriggers, todayISO } from "../lib/services";
import { syncUserCreate, syncUserUpdate, syncRoleSave, syncRolePerms, syncTeamCreate, syncRuleSave, syncRuleToggle, syncRuleDelete } from "../lib/adminSync";
import type { User, Role, AutomationRule, TriggerKey, RuleAction, ModuleKey, Perm } from "../lib/types";
import { Btn, Badge, Modal, Field, Input, Select, Textarea, Tabs, EmptyState, Avatar, Toggle, statusTone } from "../components/ui";

const MODULES: ModuleKey[] = ["dashboard", "leads", "discovery", "customers", "companies", "contacts", "deals", "followups", "tasks", "meetings", "calendar", "quotations", "invoices", "payments", "expenses", "products", "employees", "reports", "automation", "ai", "settings", "audit"];
const PERMS: Perm[] = ["view", "create", "edit", "delete", "assign", "export", "approve"];
const TRIGGERS: { k: TriggerKey; label: string }[] = [
  { k: "lead.created", label: "Lead Created" }, { k: "lead.assigned", label: "Lead Assigned" }, { k: "lead.scored", label: "Lead Scored" },
  { k: "lead.status", label: "Lead Status Changed" }, { k: "quote.sent", label: "Quotation Sent" }, { k: "invoice.overdue", label: "Invoice Overdue" }, { k: "followup.missed", label: "Follow-up Missed" },
];

// ================= EMPLOYEES / TEAMS / ROLES =================
function UserModal({ onDone }: { onDone: () => void }) {
  const { user, toast } = useStore();
  const d = useDB();
  const [f, setF] = useState(() => ({ name: "", email: "", phone: "", roleId: (d.roles.find((r) => r.name === "Sales Executive") || d.roles[0])?.id || "r_sales", teamId: "", password: "Sales@123" }));
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!f.name.trim() || !f.email.trim()) { toast("Name and email required", "err"); return; }
    if (d.users.some((u) => u.email.toLowerCase() === f.email.toLowerCase())) { toast("Email already exists", "err"); return; }
    const roleName = d.roles.find((r) => r.id === f.roleId)?.name || "";
    const isSales = roleName === "Sales Executive";
    setBusy(true);
    try {
      await syncUserCreate({ ...f, isSales }); // PostgreSQL in production mode
    } catch (e) { toast(e instanceof Error ? e.message : "Server rejected the new user", "err"); setBusy(false); return; }
    const colors = ["#0F766E", "#B45309", "#4F46E5", "#DB2777", "#059669", "#D97706"];
    mutate((db) => db.users.push({ id: uid(), name: f.name, email: f.email, phone: f.phone, passHash: hashPass(f.password), roleId: f.roleId, teamId: f.teamId || undefined, active: true, color: colors[db.users.length % colors.length], isSales, createdAt: new Date().toISOString() }));
    logAudit(user!.id, "User Created", `user:${f.email}`, `${f.name} (${roleName})`);
    toast("User created", "ok", f.email);
    setBusy(false);
    onDone();
  };
  return (
    <div className="grid grid-cols-2 gap-3">
      <Field label="Full name" req><Input value={f.name} onChange={(e) => setF((p) => ({ ...p, name: e.target.value }))} /></Field>
      <Field label="Email" req><Input value={f.email} onChange={(e) => setF((p) => ({ ...p, email: e.target.value }))} /></Field>
      <Field label="Phone"><Input value={f.phone} onChange={(e) => setF((p) => ({ ...p, phone: e.target.value }))} /></Field>
      <Field label="Temporary password"><Input value={f.password} onChange={(e) => setF((p) => ({ ...p, password: e.target.value }))} /></Field>
      <Field label="Role"><Select value={f.roleId} onChange={(e) => setF((p) => ({ ...p, roleId: e.target.value }))}>{d.roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</Select></Field>
      <Field label="Team"><Select value={f.teamId} onChange={(e) => setF((p) => ({ ...p, teamId: e.target.value }))}><option value="">—</option>{d.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select></Field>
      <div className="col-span-2 flex justify-end gap-2"><Btn variant="ghost" onClick={onDone}>Cancel</Btn><Btn onClick={() => void save()} loading={busy}>Create user</Btn></div>
    </div>
  );
}

export function EmployeesPage() {
  const { user, can, toast } = useStore();
  const d = useDB();
  const [tab, setTab] = useState("employees");
  const [addUser, setAddUser] = useState(false);
  const [roleSel, setRoleSel] = useState<string | null>(null);
  const [teamModal, setTeamModal] = useState(false);
  const [teamF, setTeamF] = useState({ name: "", focus: "", memberIds: [] as string[] });

  const saveRole = async (roleId: string, patch: Partial<Role>) => {
    try {
      if (patch.perms) await syncRolePerms(roleId, patch.perms);
      else await syncRoleSave(roleId, patch);
    } catch (e) { toast(e instanceof Error ? e.message : "Could not save role on the server", "err"); return; }
    mutate((db) => { const r = db.roles.find((x) => x.id === roleId); if (r) Object.assign(r, patch); });
    logAudit(user!.id, patch.perms ? "Permission Changed" : "Role Changed", `role:${roleId}`, patch.name || "matrix updated");
    toast("Role saved");
  };
  const activeRole = d.roles.find((r) => r.id === roleSel) || d.roles[2];

  return (
    <div className="mx-auto max-w-[1250px] p-4 md:p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div><h1 className="hd text-[22px]">People & Access</h1><p className="text-[12.5px] text-ink-500">{d.users.length} users · {d.teams.length} teams · {d.roles.length} roles</p></div>
        {tab === "employees" && can("employees", "create") && <Btn size="sm" onClick={() => setAddUser(true)}><Plus size={14} /> Add user</Btn>}
        {tab === "teams" && can("employees", "create") && <Btn size="sm" onClick={() => { setTeamF({ name: "", focus: "", memberIds: [] }); setTeamModal(true); }}><Plus size={14} /> New team</Btn>}
      </div>
      <Tabs className="mb-4" tabs={[{ key: "employees", label: "Employees", count: d.users.length }, { key: "teams", label: "Teams", count: d.teams.length }, { key: "roles", label: "Roles & Permissions", count: d.roles.length }]} active={tab} onChange={setTab} />

      {tab === "employees" && (
        <div className="card overflow-hidden"><div className="overflow-x-auto"><table className="w-full">
          <thead className="border-b border-ink-200/70 bg-ink-50/70 dark:border-ink-700 dark:bg-ink-800/50"><tr><th className="th">User</th><th className="th">Role</th><th className="th">Team</th><th className="th">Open leads</th><th className="th">Last login</th><th className="th">Active</th></tr></thead>
          <tbody>{d.users.map((u) => (
            <tr key={u.id} className="border-b border-ink-100/70 transition-colors hover:bg-brand-50/40 dark:border-ink-800 dark:hover:bg-ink-800/50">
              <td className="td"><span className="flex items-center gap-2.5"><Avatar name={u.name} color={u.color} size={30} /><span><span className="block font-semibold text-ink-900 dark:text-ink-50">{u.name}</span><span className="num block text-[11px] text-ink-400">{u.email}</span></span></span></td>
              <td className="td">
                {can("employees", "edit") && u.id !== user!.id ? (
                  <Select className="!w-auto" value={u.roleId} onChange={(e) => { const newRole = e.target.value; const isSales = d.roles.find((r) => r.id === newRole)?.name === "Sales Executive"; void syncUserUpdate(u.id, { roleId: newRole, isSales }).catch((err) => toast(err instanceof Error ? err.message : "Server update failed", "err")); mutate((db) => { const x = db.users.find((y) => y.id === u.id); if (x) { x.roleId = newRole; x.isSales = isSales; } }); logAudit(user!.id, "Role Changed", `user:${u.email}`, `→ ${d.roles.find((r) => r.id === newRole)?.name}`); toast("Role updated"); }}>
                    {d.roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                  </Select>
                ) : <Badge tone="violet">{d.roles.find((r) => r.id === u.roleId)?.name}</Badge>}
              </td>
              <td className="td text-[12.5px]">{d.teams.find((t) => t.id === u.teamId)?.name || "—"}</td>
              <td className="td num">{d.leads.filter((l) => l.assigneeId === u.id && !["Converted", "Lost"].includes(l.status)).length}</td>
              <td className="td num text-[11.5px] text-ink-400">{u.lastLogin ? fmtDT(u.lastLogin) : "never"}</td>
              <td className="td">{can("employees", "edit") && u.id !== user!.id ? <Toggle on={u.active} onChange={(v) => { void syncUserUpdate(u.id, { active: v }).catch((err) => toast(err instanceof Error ? err.message : "Server update failed", "err")); mutate((db) => { const x = db.users.find((y) => y.id === u.id); if (x) x.active = v; }); logAudit(user!.id, v ? "User Enabled" : "User Disabled", `user:${u.email}`, ""); toast(v ? "User enabled" : "User disabled", v ? "ok" : "warn"); }} /> : <Badge tone={u.active ? "green" : "red"}>{u.active ? "Yes" : "No"}</Badge>}</td>
            </tr>
          ))}</tbody>
        </table></div></div>
      )}

      {tab === "teams" && (
        <div className="grid gap-3 md:grid-cols-3">
          {d.teams.map((t) => (
            <div key={t.id} className="card p-4">
              <div className="flex items-start justify-between">
                <div><div className="hd text-[14px]">{t.name}</div><div className="text-[11.5px] text-ink-400">{t.focus}</div></div>
                <Badge tone="teal">{t.memberIds.length} member(s)</Badge>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {t.memberIds.map((id) => { const u = d.users.find((x) => x.id === id); return u ? <span key={id} className="flex items-center gap-1.5 rounded-full border border-ink-200 py-0.5 pl-0.5 pr-2 text-[11.5px] dark:border-ink-700"><Avatar name={u.name} color={u.color} size={18} />{u.name.split(" ")[0]}
                  {can("employees", "edit") && <button className="text-ink-300 hover:text-red-500" onClick={() => { mutate((db) => { const tm = db.teams.find((x) => x.id === t.id); if (tm) tm.memberIds = tm.memberIds.filter((m) => m !== id); const usr = db.users.find((x) => x.id === id); if (usr) usr.teamId = undefined; }); }}><Trash2 size={11} /></button>}</span> : null; })}
              </div>
              {can("employees", "edit") && (
                <Select className="mt-3 !w-auto" defaultValue="" onChange={(e) => { if (!e.target.value) return; mutate((db) => { const tm = db.teams.find((x) => x.id === t.id); if (tm && !tm.memberIds.includes(e.target.value)) tm.memberIds.push(e.target.value); const usr = db.users.find((x) => x.id === e.target.value); if (usr) usr.teamId = t.id; }); e.target.value = ""; }}>
                  <option value="" disabled>+ Add member…</option>
                  {d.users.filter((u) => u.isSales && !t.memberIds.includes(u.id)).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </Select>
              )}
            </div>
          ))}
        </div>
      )}

      {tab === "roles" && (
        <div className="grid gap-4 lg:grid-cols-[240px_1fr]">
          <div className="card h-fit p-2">
            {d.roles.map((r) => (
              <button key={r.id} onClick={() => setRoleSel(r.id)} className={`mb-0.5 block w-full rounded-md px-3 py-2 text-left transition-all ${activeRole.id === r.id ? "bg-brand-600 text-white" : "text-ink-600 hover:bg-ink-100 dark:text-ink-300 dark:hover:bg-ink-800"}`}>
                <span className="flex items-center gap-1.5 text-[12.5px] font-semibold"><Shield size={12} /> {r.name}{r.system && <span className={`text-[9px] ${activeRole.id === r.id ? "text-white/60" : "text-ink-400"}`}>· system</span>}</span>
                <span className={`block text-[10.5px] ${activeRole.id === r.id ? "text-white/70" : "text-ink-400"}`}>{r.description}</span>
              </button>
            ))}
            {can("employees", "create") && (
              <Btn variant="outline" size="sm" className="mt-2 w-full" onClick={() => { const id = uid(); mutate((db) => db.roles.push({ id, name: "Custom Role", description: "Custom role", system: false, perms: { dashboard: ["view"], leads: ["view"] } })); setRoleSel(id); toast("Custom role created"); }}><Plus size={13} /> New role</Btn>
            )}
          </div>
          <div className="card overflow-hidden">
            <div className="flex items-center justify-between border-b border-ink-200/70 px-4 py-3 dark:border-ink-700">
              <div>
                <span className="hd text-[14px]">{activeRole.name}</span>
                {activeRole.id !== "r_super" && can("employees", "edit") && (
                  <input className="inp ml-3 !w-40 !py-1 text-[12px]" defaultValue={activeRole.name} key={activeRole.id + activeRole.name} onBlur={(e) => { if (e.target.value && e.target.value !== activeRole.name) saveRole(activeRole.id, { name: e.target.value }); }} />
                )}
              </div>
              <span className="text-[11px] text-ink-400">{d.users.filter((u) => u.roleId === activeRole.id).length} user(s) hold this role</span>
            </div>
            <div className="max-h-[480px] overflow-auto">
              <table className="w-full">
                <thead className="sticky top-0 bg-ink-100/95 backdrop-blur dark:bg-ink-800/95"><tr><th className="th">Module</th>{PERMS.map((p) => <th key={p} className="th text-center">{p}</th>)}</tr></thead>
                <tbody>{MODULES.map((m) => {
                  const isSuper = activeRole.id === "r_super" || activeRole.id === "r_admin";
                  const has = activeRole.perms[m] || [];
                  return (
                    <tr key={m} className="border-b border-ink-100/70 dark:border-ink-800">
                      <td className="td font-semibold capitalize">{m}</td>
                      {PERMS.map((p) => {
                        const on = isSuper || has.includes(p);
                        return (
                          <td key={p} className="td text-center">
                            <button disabled={isSuper || !can("employees", "edit")} onClick={() => {
                              const next = on ? has.filter((x) => x !== p) : [...has, p];
                              saveRole(activeRole.id, { perms: { ...activeRole.perms, [m]: next } });
                            }} className={`mx-auto flex h-5 w-5 items-center justify-center rounded border transition-all ${on ? "border-brand-500 bg-brand-600 text-white" : "border-ink-300 dark:border-ink-600"} ${isSuper ? "opacity-60" : "hover:border-brand-400"}`}>
                              {on && <Check size={12} />}
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}</tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {addUser && <Modal open onClose={() => setAddUser(false)} title="Add user"><UserModal onDone={() => setAddUser(false)} /></Modal>}
      {teamModal && (
        <Modal open onClose={() => setTeamModal(false)} title="New team">
          <div className="space-y-3">
            <Field label="Team name" req><Input value={teamF.name} onChange={(e) => setTeamF((p) => ({ ...p, name: e.target.value }))} /></Field>
            <Field label="Focus (industry / region keywords)"><Input value={teamF.focus} onChange={(e) => setTeamF((p) => ({ ...p, focus: e.target.value }))} placeholder="Software & IT services — Pune region" /></Field>
            <div><span className="lbl">Members</span>
              <div className="flex flex-wrap gap-2">{d.users.filter((u) => u.isSales).map((u) => {
                const on = teamF.memberIds.includes(u.id);
                return <button key={u.id} onClick={() => setTeamF((p) => ({ ...p, memberIds: on ? p.memberIds.filter((x) => x !== u.id) : [...p.memberIds, u.id] }))} className={`flex items-center gap-1.5 rounded-full border px-2 py-1 text-[11.5px] ${on ? "border-brand-400 bg-brand-50 text-brand-700 dark:bg-brand-900/30 dark:text-brand-200" : "border-ink-200 text-ink-500 dark:border-ink-700"}`}><Avatar name={u.name} color={u.color} size={18} />{u.name.split(" ")[0]}</button>;
              })}</div>
            </div>
          </div>
          <div className="mt-4 flex justify-end gap-2"><Btn variant="ghost" onClick={() => setTeamModal(false)}>Cancel</Btn>
            <Btn onClick={() => { if (!teamF.name.trim()) return; void syncTeamCreate(teamF).then(() => { mutate((db) => db.teams.push({ id: uid(), ...teamF })); toast("Team created"); setTeamModal(false); }).catch((err) => toast(err instanceof Error ? err.message : "Server rejected the team", "err")); }}>Create team</Btn></div>
        </Modal>
      )}
      {can("employees", "view") && <span className="hidden"><Users size={1} /></span>}
    </div>
  );
}

// ================= AUTOMATION =================
const ACTION_TYPES: { k: RuleAction["type"]; label: string }[] = [
  { k: "assign_team", label: "Assign to team" }, { k: "assign_user", label: "Assign to user" }, { k: "assign_strategy", label: "Apply strategy" },
  { k: "followup", label: "Create follow-up" }, { k: "notify", label: "Notify" }, { k: "set_priority", label: "Set priority" }, { k: "set_status", label: "Set status" },
];

export function AutomationPage() {
  const { user, can, toast } = useStore();
  const d = useDB();
  const [modal, setModal] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [f, setF] = useState<Partial<AutomationRule>>({ trigger: "lead.created", condField: "", condOp: "gte", condValue: "", actions: [{ type: "followup", value: "24", hours: 24, fuType: "Call" }], enabled: true, name: "" });

  const save = async () => {
    if (!f.name?.trim()) { toast("Rule name required", "err"); return; }
    try { await syncRuleSave({ ...f, id: editId || undefined }, !!editId); }
    catch (e) { toast(e instanceof Error ? e.message : "Server rejected the rule", "err"); return; }
    if (editId) { mutate((db) => { const r = db.rules.find((x) => x.id === editId); if (r) Object.assign(r, f); }); logAudit(user!.id, "Automation Modified", editId, f.name!); toast("Rule updated"); }
    else { mutate((db) => db.rules.push({ id: uid(), name: f.name!, trigger: f.trigger as TriggerKey, condField: f.condField || "", condOp: f.condOp || "eq", condValue: f.condValue || "", actions: f.actions || [], enabled: f.enabled ?? true })); toast("Rule created"); }
    setModal(false); setEditId(null);
  };
  const describeAction = (a: RuleAction) => {
    const t = ACTION_TYPES.find((x) => x.k === a.type)?.label || a.type;
    if (a.type === "assign_team") return `${t}: ${d.teams.find((x) => x.id === a.value)?.name || a.value}`;
    if (a.type === "assign_user" || a.type === "notify") return `${t}: ${a.value === "managers" ? "managers" : d.users.find((x) => x.id === a.value)?.name || a.value}`;
    if (a.type === "followup") return `${t}: ${a.fuType || "Call"} in ${a.hours || a.value}h`;
    return `${t}: ${a.value}`;
  };
  const runs = useMemo(() => d.ruleRuns, [d.ruleRuns]);

  return (
    <div className="mx-auto max-w-[1100px] p-4 md:p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div><h1 className="hd flex items-center gap-2 text-[22px]"><Zap size={20} className="text-amber-500" /> Automation Rules</h1>
          <p className="text-[12.5px] text-ink-500">Trigger → condition → actions. Executed by the engine on live events; every run is logged.</p></div>
        {can("automation", "create") && <Btn size="sm" onClick={() => { setEditId(null); setF({ trigger: "lead.created", condField: "", condOp: "gte", condValue: "", actions: [{ type: "followup", value: "24", hours: 24, fuType: "Call" }], enabled: true, name: "" }); setModal(true); }}><Plus size={14} /> New rule</Btn>}
      </div>
      <div className="space-y-2">
        {d.rules.map((r) => (
          <div key={r.id} className={`card flex flex-wrap items-center gap-3 p-3.5 transition-all hover:shadow-md ${r.enabled ? "" : "opacity-55"}`}>
            <Toggle on={r.enabled} onChange={(v) => { void syncRuleToggle(r.id, v).catch((err) => toast(err instanceof Error ? err.message : "Server update failed", "err")); mutate((db) => { const x = db.rules.find((y) => y.id === r.id); if (x) x.enabled = v; }); toast(v ? "Rule enabled" : "Rule disabled", v ? "ok" : "warn"); }} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2"><span className="text-[13.5px] font-semibold text-ink-800 dark:text-ink-100">{r.name}</span><Badge tone="blue">{TRIGGERS.find((t) => t.k === r.trigger)?.label}</Badge>
                {r.condField && <Badge tone="slate">if {r.condField} {r.condOp} {r.condValue}</Badge>}</div>
              <div className="mt-1 text-[11.5px] text-ink-400">{r.actions.map(describeAction).join("  →  ")}</div>
            </div>
            <span className="num text-[10.5px] text-ink-400">{d.ruleRuns.filter((x) => x.ruleId === r.id).length} runs</span>
            {can("automation", "edit") && <button className="rounded p-1 text-ink-400 hover:text-brand-600" onClick={() => { setEditId(r.id); setF({ ...r, actions: r.actions.map((a) => ({ ...a })) }); setModal(true); }}><Pencil size={13} /></button>}
            {can("automation", "delete") && <button className="rounded p-1 text-ink-400 hover:text-red-500" onClick={() => { if (window.confirm(`Delete rule "${r.name}"?`)) { void syncRuleDelete(r.id).catch((err) => toast(err instanceof Error ? err.message : "Server delete failed", "err")); mutate((db) => { db.rules = db.rules.filter((x) => x.id !== r.id); }); toast("Rule deleted", "warn"); } }}><Trash2 size={13} /></button>}
          </div>
        ))}
        {d.rules.length === 0 && <EmptyState icon={<Zap size={24} />} title="No automation rules" />}
      </div>

      <h3 className="hd mb-2 mt-6 text-[15px]">Execution log</h3>
      <div className="card overflow-hidden">
        <table className="w-full">
          <thead className="border-b border-ink-200/70 bg-ink-50/70 dark:border-ink-700 dark:bg-ink-800/50"><tr><th className="th">When</th><th className="th">Rule</th><th className="th">What happened</th></tr></thead>
          <tbody>{runs.slice(0, 15).map((x) => (
            <tr key={x.id} className="border-b border-ink-100/70 dark:border-ink-800">
              <td className="td num text-[11.5px] text-ink-400">{fmtDT(x.at)}</td>
              <td className="td font-medium">{x.ruleName}</td>
              <td className="td text-[12.5px] text-ink-500">{x.summary}</td>
            </tr>
          ))}</tbody>
        </table>
        {runs.length === 0 && <EmptyState title="No executions yet" body="Trigger events (new lead, quote sent…) will appear here." />}
      </div>

      {modal && (
        <Modal open onClose={() => setModal(false)} title={editId ? "Edit rule" : "New automation rule"} wide>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Rule name" req className="col-span-2"><Input value={f.name || ""} onChange={(e) => setF((p) => ({ ...p, name: e.target.value }))} placeholder="Hot leads → senior team + 4h follow-up" /></Field>
            <Field label="Trigger"><Select value={f.trigger} onChange={(e) => setF((p) => ({ ...p, trigger: e.target.value as TriggerKey }))}>{TRIGGERS.map((t) => <option key={t.k} value={t.k}>{t.label}</option>)}</Select></Field>
            <div className="grid grid-cols-3 gap-2">
              <Field label="If field"><Select value={f.condField || ""} onChange={(e) => setF((p) => ({ ...p, condField: e.target.value }))}><option value="">always</option><option value="score">score</option><option value="city">city</option><option value="category">category</option><option value="industry">industry</option><option value="priority">priority</option></Select></Field>
              <Field label="Op"><Select value={f.condOp} onChange={(e) => setF((p) => ({ ...p, condOp: e.target.value as AutomationRule["condOp"] }))}><option value="eq">=</option><option value="neq">≠</option><option value="gte">≥</option><option value="lte">≤</option><option value="contains">contains</option></Select></Field>
              <Field label="Value"><Input value={f.condValue || ""} onChange={(e) => setF((p) => ({ ...p, condValue: e.target.value }))} placeholder="80" /></Field>
            </div>
          </div>
          <div className="mt-3">
            <span className="lbl">Then do…</span>
            {(f.actions || []).map((a, i) => (
              <div key={i} className="mb-2 flex flex-wrap items-center gap-2 rounded-md border border-ink-200 p-2 dark:border-ink-700">
                <Select className="!w-auto" value={a.type} onChange={(e) => setF((p) => ({ ...p, actions: (p.actions || []).map((x, j) => j === i ? { ...x, type: e.target.value as RuleAction["type"] } : x) }))}>
                  {ACTION_TYPES.map((t) => <option key={t.k} value={t.k}>{t.label}</option>)}
                </Select>
                {a.type === "assign_team" && <Select className="!w-auto" value={a.value} onChange={(e) => setF((p) => ({ ...p, actions: (p.actions || []).map((x, j) => j === i ? { ...x, value: e.target.value } : x) }))}>{d.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select>}
                {(a.type === "assign_user" || a.type === "notify") && <Select className="!w-auto" value={a.value} onChange={(e) => setF((p) => ({ ...p, actions: (p.actions || []).map((x, j) => j === i ? { ...x, value: e.target.value } : x) }))}><option value="managers">managers</option>{d.users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select>}
                {a.type === "followup" && <>
                  <Select className="!w-auto" value={a.fuType || "Call"} onChange={(e) => setF((p) => ({ ...p, actions: (p.actions || []).map((x, j) => j === i ? { ...x, fuType: e.target.value as RuleAction["fuType"] } : x) }))}>{["Call", "WhatsApp", "Email", "Demo", "Meeting"].map((t) => <option key={t}>{t}</option>)}</Select>
                  <span className="text-[12px] text-ink-400">after</span>
                  <Input type="number" className="!w-16" value={a.hours || 24} onChange={(e) => setF((p) => ({ ...p, actions: (p.actions || []).map((x, j) => j === i ? { ...x, hours: Number(e.target.value), value: e.target.value } : x) }))} />
                  <span className="text-[12px] text-ink-400">hours</span>
                </>}
                {(a.type === "set_priority") && <Select className="!w-auto" value={a.value} onChange={(e) => setF((p) => ({ ...p, actions: (p.actions || []).map((x, j) => j === i ? { ...x, value: e.target.value } : x) }))}>{["Low", "Medium", "High", "Urgent"].map((t) => <option key={t}>{t}</option>)}</Select>}
                {(a.type === "set_status" || a.type === "assign_strategy") && <Input className="!w-36" value={a.value} onChange={(e) => setF((p) => ({ ...p, actions: (p.actions || []).map((x, j) => j === i ? { ...x, value: e.target.value } : x) }))} placeholder={a.type === "set_status" ? "Qualified" : "round_robin"} />}
                <button className="ml-auto rounded p-1 text-ink-400 hover:text-red-500" onClick={() => setF((p) => ({ ...p, actions: (p.actions || []).filter((_, j) => j !== i) }))}><Trash2 size={13} /></button>
              </div>
            ))}
            <Btn variant="ghost" size="sm" onClick={() => setF((p) => ({ ...p, actions: [...(p.actions || []), { type: "notify", value: "managers" }] }))}><Plus size={13} /> Add action</Btn>
          </div>
          <div className="mt-4 flex items-center justify-between">
            <Toggle on={f.enabled ?? true} onChange={(v) => setF((p) => ({ ...p, enabled: v }))} label="Enabled" />
            <div className="flex gap-2"><Btn variant="ghost" onClick={() => setModal(false)}>Cancel</Btn><Btn onClick={() => void save()}>{editId ? "Save rule" : "Create rule"}</Btn></div>
          </div>
        </Modal>
      )}
      <span className="hidden">{todayISO()}{statusTone("")}</span>
    </div>
  );
}

// ================= AUDIT =================
export function AuditPage() {
  const d = useDB();
  const [q, setQ] = useState("");
  const logs = d.auditLogs.filter((l) => !q || [l.action, l.userName, l.target, l.detail].some((v) => v.toLowerCase().includes(q.toLowerCase())));
  return (
    <div className="mx-auto max-w-[1000px] p-4 md:p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div><h1 className="hd text-[22px]">Audit Log</h1><p className="text-[12.5px] text-ink-500">Sensitive actions are tracked and read-only. {d.auditLogs.length} entries.</p></div>
        <div className="relative max-w-xs flex-1"><Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-400" /><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter actions, users, targets…" className="pl-8" /></div>
      </div>
      <div className="card overflow-hidden">
        <table className="w-full">
          <thead className="border-b border-ink-200/70 bg-ink-50/70 dark:border-ink-700 dark:bg-ink-800/50"><tr><th className="th">When</th><th className="th">User</th><th className="th">Action</th><th className="th">Target</th><th className="th">Detail</th></tr></thead>
          <tbody>{logs.map((l) => (
            <tr key={l.id} className="border-b border-ink-100/70 transition-colors hover:bg-brand-50/40 dark:border-ink-800 dark:hover:bg-ink-800/50">
              <td className="td num text-[11.5px] text-ink-400">{fmtDT(l.at)}</td>
              <td className="td font-medium">{l.userName}</td>
              <td className="td"><Badge tone={l.action.includes("Failed") || l.action.includes("Deleted") ? "red" : l.action.includes("Login") ? "blue" : "slate"}>{l.action}</Badge></td>
              <td className="td num text-[11.5px] text-ink-500">{l.target}</td>
              <td className="td text-[12.5px] text-ink-500">{l.detail}</td>
            </tr>
          ))}</tbody>
        </table>
        {logs.length === 0 && <EmptyState title="No audit entries match" />}
      </div>
    </div>
  );
}
