import { useEffect, useMemo, useState } from "react";
import { Building2, Copy, Eye, KeyRound, Pencil, Plus, Search, ShieldCheck, Trash2, UserCheck, UserX, Users } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useStore } from "../store";
import { useDB } from "../lib/db";
import { api, DEMO_MODE } from "../lib/api";
import { Avatar, Badge, Btn, Field, Input, Modal, Select, Toggle } from "../components/ui";
import { fmtDT } from "../lib/services";

type BackendUser = {
  id: number;
  name: string;
  email: string;
  phone?: string;
  department?: string;
  designation?: string;
  role_id?: number | null;
  team_id?: number | null;
  access_level?: number;
  active?: boolean;
  color?: string;
  is_sales?: boolean;
  created_at?: string;
  last_login_at?: string | null;
  must_change_password?: boolean;
};

type WorkforceRole = {
  id: number;
  name: string;
  department_key: string;
  department: string;
  access_level: number;
  primary_function: string;
  member_count?: number;
  workforce_role: boolean;
  assignment_enabled: boolean;
};

type Department = {
  id: number;
  name: string;
  system_key?: string | null;
  system?: boolean;
  active: boolean;
};

type FormState = {
  name: string;
  email: string;
  phone: string;
  department: string;
  roleId: string;
  teamId: string;
  password: string;
  active: boolean;
};

const normalizeEmail = (value: string) => value.trim().toLowerCase();
const tempPassword = () => `ITCT@${Math.random().toString(36).slice(2, 8)}${Math.floor(10 + Math.random() * 89)}`;
const levelCode = (value?: number | null) => value && value >= 1 && value <= 6 ? `L${value}` : "—";

function EmployeeEditor({
  employee,
  roles,
  departments,
  onClose,
  onSaved,
}: {
  employee: BackendUser | null;
  roles: WorkforceRole[];
  departments: Department[];
  onClose: () => void;
  onSaved: (row: BackendUser) => void;
}) {
  const { toast } = useStore();
  const d = useDB();
  const approvedDepartments = useMemo(
    () => departments.filter((x) => x.system && x.active),
    [departments],
  );
  const departmentLocked = !employee && approvedDepartments.length === 1;
  const defaultDepartment = employee?.department || (departmentLocked ? approvedDepartments[0].name : "");
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<FormState>(() => ({
    name: employee?.name || "",
    email: employee?.email || "",
    phone: employee?.phone || "",
    department: defaultDepartment,
    roleId: employee?.role_id ? String(employee.role_id) : "",
    teamId: employee?.team_id ? String(employee.team_id) : "",
    password: employee ? "" : tempPassword(),
    active: employee?.active !== false,
  }));

  const availableRoles = useMemo(
    () => roles.filter((x) => x.assignment_enabled && x.department === form.department),
    [roles, form.department],
  );
  const selectedRole = roles.find((x) => String(x.id) === form.roleId) || null;
  const currentRoleName = employee
    ? roles.find((x) => x.id === employee.role_id)?.name || d.roles.find((x) => Number(x.id) === Number(employee.role_id))?.name || "Legacy / unrecognized role"
    : "";
  const existingRoleIsApproved = !!employee && roles.some((x) => x.id === employee.role_id);

  const changeDepartment = (department: string) => {
    setForm((p) => {
      const role = roles.find((x) => String(x.id) === p.roleId);
      return { ...p, department, roleId: role?.department === department ? p.roleId : "", teamId: "" };
    });
  };

  const save = async () => {
    const name = form.name.trim();
    const email = normalizeEmail(form.email);
    if (!name || !email) { toast("Name and email are required", "err"); return; }
    if (!employee && form.password.length < 8) { toast("Temporary password must be at least 8 characters", "err"); return; }
    if (!form.roleId) { toast("Select an approved Workforce OS role", "err"); return; }

    const role = roles.find((x) => String(x.id) === form.roleId);
    const keepingLegacy = !!employee && Number(form.roleId) === Number(employee.role_id) && !existingRoleIsApproved;
    if (!role && !keepingLegacy) { toast("Select an approved Workforce OS role", "err"); return; }
    if (role && role.department !== form.department) { toast("Department and role must match", "err"); return; }

    setBusy(true);
    try {
      const body = {
        name,
        email,
        phone: form.phone.trim(),
        role_id: Number(form.roleId),
        department: role?.department || form.department,
        team_id: form.teamId ? Number(form.teamId) : null,
        active: form.active,
      };
      if (DEMO_MODE) {
        toast("Workforce employee changes require the production backend", "warn");
        return;
      }
      const r = employee
        ? await api.patch<BackendUser>(`/users/${employee.id}`, body)
        : await api.post<BackendUser>("/users", { ...body, password: form.password });
      onSaved(r.data);
      toast(employee ? "Employee updated" : "Employee created", "ok",
        role ? `${role.name} · ${role.department} · L${role.access_level}` : currentRoleName);
      onClose();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not save employee", "err");
    } finally { setBusy(false); }
  };

  return (
    <Modal open onClose={onClose} title={employee ? "Edit employee" : "Add employee"} footer={
      <><Btn variant="ghost" onClick={onClose}>Cancel</Btn><Btn loading={busy} onClick={() => void save()}>{employee ? "Save changes" : "Create employee"}</Btn></>
    }>
      <div className="mb-4 rounded-lg border border-brand-100 bg-brand-50/60 p-3 text-[11.5px] leading-relaxed text-brand-800 dark:border-brand-900 dark:bg-brand-950/20 dark:text-brand-200">
        <strong>Workforce rule:</strong> department and role are linked by the approved Workforce OS specification. Department Heads can add employees only inside their own department; the department is locked automatically.
      </div>
      {employee && !existingRoleIsApproved && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-[11.5px] text-amber-800 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-200">
          Current role <strong>{currentRoleName}</strong> is a legacy CRM role. The employee is preserved, but new assignments use only approved PDF roles. Choose an approved department + role when you are ready to migrate this employee.
        </div>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Full name" req><Input value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} /></Field>
        <Field label="Email" req><Input type="email" value={form.email} onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))} /></Field>
        <Field label="Phone"><Input value={form.phone} onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))} /></Field>
        {!employee && <Field label="Temporary password" req><div className="flex gap-2"><Input value={form.password} onChange={(e) => setForm((p) => ({ ...p, password: e.target.value }))} /><Btn type="button" size="xs" variant="outline" onClick={() => setForm((p) => ({ ...p, password: tempPassword() }))}>Generate</Btn></div></Field>}

        <Field label="Department" req>
          <Select value={form.department} onChange={(e) => changeDepartment(e.target.value)} disabled={departmentLocked}>
            <option value="">Select approved department</option>
            {approvedDepartments.map((dept) => <option key={dept.id} value={dept.name}>{dept.name}</option>)}
            {employee?.department && !approvedDepartments.some((x) => x.name === employee.department) && <option value={employee.department}>{employee.department} (legacy)</option>}
          </Select>
          {departmentLocked && <div className="mt-1 text-[10.5px] text-brand-600">Fixed to your Department Head scope: {form.department}</div>}
        </Field>
        <Field label="Approved role" req>
          <Select value={form.roleId} onChange={(e) => setForm((p) => ({ ...p, roleId: e.target.value }))}>
            <option value="">Select role</option>
            {employee && !existingRoleIsApproved && form.roleId === String(employee.role_id) && <option value={form.roleId}>{currentRoleName} (legacy — keep unchanged)</option>}
            {availableRoles.map((role) => <option key={role.id} value={role.id}>L{role.access_level} · {role.name}</option>)}
          </Select>
        </Field>

        {selectedRole && (
          <div className="sm:col-span-2 rounded-lg border border-ink-200 bg-ink-50 p-3 dark:border-ink-700 dark:bg-ink-800/40">
            <div className="flex flex-wrap items-center gap-2"><Badge tone="amber">L{selectedRole.access_level}</Badge><strong className="text-[12.5px]">{selectedRole.name}</strong><Badge tone="green">{selectedRole.department}</Badge></div>
            <p className="mt-2 text-[11.5px] leading-relaxed text-ink-500">{selectedRole.primary_function}</p>
          </div>
        )}

        <Field label="Team"><Select value={form.teamId} onChange={(e) => setForm((p) => ({ ...p, teamId: e.target.value }))}><option value="">No team</option>{d.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select></Field>
        {employee && <div className="flex items-end pb-1"><Toggle on={form.active} onChange={(active) => setForm((p) => ({ ...p, active }))} label={form.active ? "Employee active" : "Employee disabled"} /></div>}
        {!employee && <div className="sm:col-span-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-[11.5px] text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">Share the temporary password securely. The employee must change it on first login.</div>}
      </div>
    </Modal>
  );
}

function ResetPasswordModal({ employee, onClose }: { employee: BackendUser | null; onClose: () => void }) {
  const { toast } = useStore();
  const [password, setPassword] = useState(() => tempPassword());
  const [busy, setBusy] = useState(false);
  if (!employee) return null;
  const reset = async () => {
    if (password.length < 8) { toast("Temporary password must be at least 8 characters", "err"); return; }
    setBusy(true);
    try {
      await api.post(`/users/${employee.id}/reset-password`, { password });
      toast("Employee password reset", "ok", `${employee.email} · temporary password: ${password}`);
      onClose();
    } catch (e) { toast(e instanceof Error ? e.message : "Could not reset password", "err"); }
    finally { setBusy(false); }
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(password); toast("Temporary password copied", "ok"); }
    catch { toast("Copy failed — copy the password manually", "warn"); }
  };
  return (
    <Modal open onClose={onClose} title="Reset employee password" footer={<><Btn variant="ghost" onClick={onClose}>Cancel</Btn><Btn loading={busy} onClick={() => void reset()}><KeyRound size={14} /> Reset password</Btn></>}>
      <p className="mb-4 text-[13px] text-ink-600 dark:text-ink-300">Set a temporary password for <strong>{employee.name}</strong>. Existing sessions will be revoked.</p>
      <Field label="Temporary password" req><div className="flex gap-2"><Input value={password} onChange={(e) => setPassword(e.target.value)} /><Btn type="button" variant="outline" onClick={() => void copy()}><Copy size={14} /> Copy</Btn></div></Field>
    </Modal>
  );
}

export default function EmployeeManagement() {
  const { user, can, toast } = useStore();
  const d = useDB();
  const nav = useNavigate();
  const [employees, setEmployees] = useState<BackendUser[]>([]);
  const [roles, setRoles] = useState<WorkforceRole[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<BackendUser | null>(null);
  const [deleting, setDeleting] = useState<BackendUser | null>(null);
  const [resetting, setResetting] = useState<BackendUser | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = async () => {
    if (DEMO_MODE) { setEmployees([]); setRoles([]); setDepartments([]); setLoading(false); return; }
    setLoading(true);
    try {
      const [u, r, dep] = await Promise.all([
        api.get<BackendUser[]>("/users"),
        api.get<WorkforceRole[]>("/workforce/roles"),
        api.get<Department[]>("/departments"),
      ]);
      setEmployees(u.data || []); setRoles(r.data || []); setDepartments(dep.data || []);
    } catch (e) { toast(e instanceof Error ? e.message : "Could not load Workforce employees", "err"); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  const roleFor = (u: BackendUser) => roles.find((r) => r.id === u.role_id) || null;
  const roleName = (u: BackendUser) => roleFor(u)?.name || d.roles.find((r) => Number(r.id) === Number(u.role_id))?.name || "Legacy / no role";
  const teamName = (u: BackendUser) => d.teams.find((t) => Number(t.id) === Number(u.team_id))?.name || "—";
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return employees;
    return employees.filter((u) => `${u.name} ${u.email} ${u.phone || ""} ${u.department || ""} ${roleName(u)} ${levelCode(u.access_level)}`.toLowerCase().includes(needle));
  }, [employees, roles, d.roles, q]);

  const saved = (row: BackendUser) => setEmployees((xs) => {
    const i = xs.findIndex((x) => x.id === row.id);
    return i < 0 ? [...xs, row] : xs.map((x) => x.id === row.id ? row : x);
  });

  const setActive = async (employee: BackendUser, active: boolean) => {
    setBusyId(employee.id);
    try {
      const r = await api.patch<BackendUser>(`/users/${employee.id}`, { active });
      saved(r.data); toast(active ? "Employee enabled" : "Employee disabled", active ? "ok" : "warn", employee.email);
    } catch (e) { toast(e instanceof Error ? e.message : "Could not update employee", "err"); }
    finally { setBusyId(null); }
  };

  const removeEmployee = async () => {
    if (!deleting) return;
    setBusyId(deleting.id);
    try {
      await api.delete(`/users/${deleting.id}`);
      setEmployees((xs) => xs.filter((x) => x.id !== deleting.id));
      toast("Employee removed", "ok", deleting.email); setDeleting(null);
    } catch (e) { toast(e instanceof Error ? e.message : "Could not remove employee", "err"); }
    finally { setBusyId(null); }
  };

  return (
    <div className="mx-auto max-w-[1280px] p-3 sm:p-4 md:p-6">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="mb-1 flex items-center gap-2"><Badge tone="green">Step 3</Badge><span className="text-[10px] font-bold uppercase tracking-[0.12em] text-ink-400">Approved Role Assignment</span></div>
          <h1 className="hd flex items-center gap-2 text-[22px]"><Users size={20} /> Employee Management</h1>
          <p className="mt-1 text-[12.5px] text-ink-500">Assign employees only to the department-specific roles defined by the Workforce OS specification.</p>
        </div>
        {can("employees", "create") && <Btn size="sm" className="w-full sm:w-auto" onClick={() => setAdding(true)}><Plus size={14} /> Add employee</Btn>}
      </div>

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <div className="card p-3"><div className="text-[10px] font-bold uppercase text-ink-400">Official roles</div><div className="num mt-1 text-[21px] font-bold">{roles.length}</div><div className="text-[10.5px] text-ink-400">Expected: 56</div></div>
        <div className="card p-3"><div className="text-[10px] font-bold uppercase text-ink-400">Employees</div><div className="num mt-1 text-[21px] font-bold">{employees.length}</div><div className="text-[10.5px] text-ink-400">{employees.filter((x) => x.active !== false).length} active</div></div>
        <div className="card p-3"><div className="text-[10px] font-bold uppercase text-ink-400">Approved departments</div><div className="num mt-1 text-[21px] font-bold">{departments.filter((x) => x.system).length}</div><div className="text-[10.5px] text-ink-400">Expected: 14</div></div>
      </div>

      <div className="mb-4 rounded-lg border border-ink-200/80 bg-surface p-3 dark:border-ink-700 dark:bg-ink-900">
        <div className="relative w-full sm:max-w-md"><Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" /><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search employee, department, role or level..." className="pl-9" /></div>
      </div>

      {loading ? <div className="card p-10 text-center text-[13px] text-ink-400">Loading employees and approved roles…</div> : (
        <>
          <div className="space-y-3 md:hidden">
            {filtered.map((u) => {
              const approved = roleFor(u);
              return <div key={u.id} className="card p-4">
                <button onClick={() => nav(`/profile/${u.id}`)} className="flex w-full items-start justify-between gap-3 text-left">
                  <div className="flex min-w-0 items-center gap-3"><Avatar name={u.name} color={u.color || "#0F766E"} size={36} /><div className="min-w-0"><div className="truncate font-semibold">{u.name}</div><div className="truncate text-[11px] text-ink-400">{u.email}</div></div></div>
                  <Badge tone={u.active !== false ? "green" : "red"}>{u.active !== false ? "Active" : "Disabled"}</Badge>
                </button>
                <div className="mt-3 grid grid-cols-2 gap-2 text-[11.5px]"><div><span className="text-ink-400">Department</span><div className="font-semibold">{u.department || "—"}</div></div><div><span className="text-ink-400">Access</span><div><Badge tone={approved ? "amber" : "red"}>{levelCode(u.access_level)}</Badge></div></div><div className="col-span-2"><span className="text-ink-400">Role</span><div className="font-semibold">{roleName(u)} {!approved && !["Super Admin", "Admin"].includes(roleName(u)) && <Badge tone="amber">Legacy</Badge>}</div></div></div>
                <div className="mt-4 flex flex-wrap gap-2"><Btn size="xs" variant="soft" onClick={() => nav(`/profile/${u.id}`)}><Eye size={12} /> Profile</Btn>{String(u.id) !== user!.id && <>{can("employees", "edit") && <Btn size="xs" variant="outline" onClick={() => setEditing(u)}><Pencil size={12} /> Edit</Btn>}{can("employees", "edit") && <Btn size="xs" variant="outline" onClick={() => setResetting(u)}><KeyRound size={12} /> Reset</Btn>}{can("employees", "edit") && <Btn size="xs" variant="ghost" disabled={busyId === u.id} onClick={() => void setActive(u, u.active === false)}>{u.active !== false ? <UserX size={12} /> : <UserCheck size={12} />}{u.active !== false ? "Disable" : "Enable"}</Btn>}{can("employees", "delete") && <Btn size="xs" variant="danger" onClick={() => setDeleting(u)}><Trash2 size={12} /> Remove</Btn>}</>}</div>
              </div>;
            })}
          </div>

          <div className="card hidden overflow-hidden md:block"><div className="overflow-x-auto"><table className="w-full min-w-[1080px]">
            <thead className="border-b border-ink-200/70 bg-ink-50/70 dark:border-ink-700 dark:bg-ink-800/50"><tr><th className="th">Employee</th><th className="th">Department</th><th className="th">Role</th><th className="th">Level</th><th className="th">Team</th><th className="th">Status</th><th className="th text-right">Actions</th></tr></thead>
            <tbody>{filtered.map((u) => { const approved = roleFor(u); const rn = roleName(u); return <tr key={u.id} className="border-b border-ink-100/70 dark:border-ink-800">
              <td className="td"><button onClick={() => nav(`/profile/${u.id}`)} className="flex items-center gap-2.5 text-left hover:text-brand-600"><Avatar name={u.name} color={u.color || "#0F766E"} size={30} /><span><span className="block font-semibold">{u.name}</span><span className="block text-[11px] text-ink-400">{u.email}</span></span></button></td>
              <td className="td text-[12px]"><span className="flex items-center gap-1.5"><Building2 size={12} className="text-ink-400" />{u.department || "—"}</span></td>
              <td className="td"><div className="flex flex-wrap items-center gap-1.5"><ShieldCheck size={12} className={approved ? "text-brand-600" : "text-amber-500"} /><span className="text-[12px] font-semibold">{rn}</span>{!approved && !["Super Admin", "Admin"].includes(rn) && <Badge tone="amber">Legacy</Badge>}</div></td>
              <td className="td"><Badge tone={approved ? "amber" : "slate"}>{levelCode(u.access_level)}</Badge></td>
              <td className="td text-[12px]">{teamName(u)}</td>
              <td className="td"><Badge tone={u.active !== false ? "green" : "red"}>{u.active !== false ? "Active" : "Disabled"}</Badge></td>
              <td className="td"><div className="flex justify-end gap-1.5"><Btn size="xs" variant="soft" onClick={() => nav(`/profile/${u.id}`)}><Eye size={12} /> Profile</Btn>{String(u.id) !== user!.id && <>{can("employees", "edit") && <Btn size="xs" variant="outline" onClick={() => setEditing(u)}><Pencil size={12} /> Edit</Btn>}{can("employees", "edit") && <Btn size="xs" variant="outline" onClick={() => setResetting(u)}><KeyRound size={12} /> Reset</Btn>}{can("employees", "edit") && <Btn size="xs" variant="ghost" disabled={busyId === u.id} onClick={() => void setActive(u, u.active === false)}>{u.active !== false ? "Disable" : "Enable"}</Btn>}{can("employees", "delete") && <Btn size="xs" variant="danger" onClick={() => setDeleting(u)}><Trash2 size={12} /> Remove</Btn>}</>}</div></td>
            </tr>; })}</tbody>
          </table></div></div>
        </>
      )}
      {!loading && filtered.length === 0 && <div className="card py-12 text-center text-[13px] text-ink-500">No employees match your search.</div>}

      {adding && <EmployeeEditor employee={null} roles={roles} departments={departments} onClose={() => setAdding(false)} onSaved={saved} />}
      {editing && <EmployeeEditor employee={editing} roles={roles} departments={departments} onClose={() => setEditing(null)} onSaved={saved} />}
      <ResetPasswordModal employee={resetting} onClose={() => setResetting(null)} />
      <Modal open={!!deleting} onClose={() => setDeleting(null)} title="Remove employee" footer={<><Btn variant="ghost" onClick={() => setDeleting(null)}>Cancel</Btn><Btn variant="danger" loading={busyId === deleting?.id} onClick={() => void removeEmployee()}>Remove employee</Btn></>}>
        <p className="text-[13px] leading-relaxed text-ink-600 dark:text-ink-300">This soft-deletes <strong>{deleting?.name}</strong>. Historical records remain in PostgreSQL for audit/history.</p>
      </Modal>
    </div>
  );
}