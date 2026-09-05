import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Copy, Eye, KeyRound, Pencil, Plus, Search, Settings2, Trash2, UserCheck, UserX, Users } from "lucide-react";
import { useStore } from "../store";
import { mutate, uid, useDB, hashPass } from "../lib/db";
import { api, DEMO_MODE } from "../lib/api";
import type { User } from "../lib/types";
import { Avatar, Badge, Btn, Field, Input, Modal, Select, Toggle } from "../components/ui";
import { fmtDT } from "../lib/services";

type SecureUser = User & { mustChangePassword?: boolean };
type EmployeeForm = {
  name: string;
  email: string;
  phone: string;
  roleId: string;
  teamId: string;
  password: string;
  active: boolean;
};

type BackendUser = {
  id: number;
  name: string;
  email: string;
  phone?: string;
  role_id?: number | null;
  team_id?: number | null;
  active?: boolean;
  color?: string;
  is_sales?: boolean;
  created_at?: string;
  last_login_at?: string | null;
  must_change_password?: boolean;
};

const normalizeEmail = (value: string) => value.trim().toLowerCase();
const tempPassword = () => `ITCT@${Math.random().toString(36).slice(2, 8)}${Math.floor(10 + Math.random() * 89)}`;

function toLocalUser(row: BackendUser, password = ""): User {
  const out: SecureUser = {
    id: String(row.id),
    name: row.name,
    email: row.email,
    phone: row.phone || "",
    passHash: password ? hashPass(password) : "",
    roleId: String(row.role_id ?? ""),
    teamId: row.team_id ? String(row.team_id) : undefined,
    active: row.active !== false,
    color: row.color || "#0F766E",
    isSales: !!row.is_sales,
    createdAt: row.created_at || new Date().toISOString(),
    lastLogin: row.last_login_at || undefined,
    mustChangePassword: !!row.must_change_password,
  };
  return out;
}

function EmployeeEditor({ open, employee, onClose }: { open: boolean; employee: User | null; onClose: () => void }) {
  const { toast } = useStore();
  const d = useDB();
  const defaultRole = (d.roles.find((r) => r.name === "Sales Executive") || d.roles[0])?.id || "";
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<EmployeeForm>(() => ({
    name: employee?.name || "",
    email: employee?.email || "",
    phone: employee?.phone || "",
    roleId: employee?.roleId || defaultRole,
    teamId: employee?.teamId || "",
    password: employee ? "" : tempPassword(),
    active: employee?.active ?? true,
  }));

  const save = async () => {
    const name = form.name.trim();
    const email = normalizeEmail(form.email);
    if (!name || !email) { toast("Name and email are required", "err"); return; }
    if (!employee && form.password.length < 8) { toast("Temporary password must be at least 8 characters", "err"); return; }
    if (d.users.some((u) => u.id !== employee?.id && normalizeEmail(u.email) === email)) {
      toast("Email already exists", "err"); return;
    }

    const roleName = d.roles.find((r) => r.id === form.roleId)?.name || "";
    const isSales = roleName === "Sales Executive";
    setBusy(true);
    try {
      if (employee) {
        if (!DEMO_MODE) {
          const r = await api.patch<BackendUser>(`/users/${employee.id}`, {
            name,
            email,
            phone: form.phone.trim(),
            role_id: Number(form.roleId),
            team_id: form.teamId ? Number(form.teamId) : null,
            is_sales: isSales,
            active: form.active,
          });
          const row = r.data;
          mutate((db) => {
            const u = db.users.find((x) => x.id === employee.id);
            if (u) Object.assign(u, {
              name: row.name,
              email: row.email,
              phone: row.phone || "",
              roleId: String(row.role_id ?? form.roleId),
              teamId: row.team_id ? String(row.team_id) : undefined,
              active: row.active !== false,
              isSales: !!row.is_sales,
            });
          });
        } else {
          mutate((db) => {
            const u = db.users.find((x) => x.id === employee.id);
            if (u) Object.assign(u, { name, email, phone: form.phone.trim(), roleId: form.roleId, teamId: form.teamId || undefined, active: form.active, isSales });
          });
        }
        toast("Employee updated", "ok", email);
      } else {
        if (!DEMO_MODE) {
          const r = await api.post<BackendUser>("/users", {
            name,
            email,
            phone: form.phone.trim(),
            password: form.password,
            role_id: Number(form.roleId),
            team_id: form.teamId ? Number(form.teamId) : null,
            department: isSales ? "Sales" : "Operations",
            designation: isSales ? "Sales Executive" : "",
            is_sales: isSales,
            active: true,
          });
          const local = toLocalUser(r.data, form.password);
          mutate((db) => db.users.push(local));
        } else {
          mutate((db) => db.users.push({
            id: uid(), name, email, phone: form.phone.trim(), passHash: hashPass(form.password),
            roleId: form.roleId, teamId: form.teamId || undefined, active: true,
            color: "#0F766E", isSales, createdAt: new Date().toISOString(),
          }));
        }
        toast("Employee created", "ok", `${email} · temporary password: ${form.password} · change required at first login`);
      }
      onClose();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not save employee", "err");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={employee ? "Edit employee" : "Add employee"} footer={
      <><Btn variant="ghost" onClick={onClose}>Cancel</Btn><Btn loading={busy} onClick={() => void save()}>{employee ? "Save changes" : "Create employee"}</Btn></>
    }>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Full name" req><Input value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} /></Field>
        <Field label="Email" req><Input type="email" value={form.email} onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))} /></Field>
        <Field label="Phone"><Input value={form.phone} onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))} /></Field>
        {!employee && <Field label="Temporary password" req><div className="flex gap-2"><Input value={form.password} onChange={(e) => setForm((p) => ({ ...p, password: e.target.value }))} /><Btn type="button" size="xs" variant="outline" onClick={() => setForm((p) => ({ ...p, password: tempPassword() }))}>Generate</Btn></div></Field>}
        <Field label="Role"><Select value={form.roleId} onChange={(e) => setForm((p) => ({ ...p, roleId: e.target.value }))}>{d.roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</Select></Field>
        <Field label="Team"><Select value={form.teamId} onChange={(e) => setForm((p) => ({ ...p, teamId: e.target.value }))}><option value="">No team</option>{d.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select></Field>
        {!employee && <div className="sm:col-span-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-[11.5px] text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">Share the temporary password securely. The employee will be forced to create a new password at first login.</div>}
        {employee && <div className="sm:col-span-2"><Toggle on={form.active} onChange={(active) => setForm((p) => ({ ...p, active }))} label={form.active ? "Employee active" : "Employee disabled"} /></div>}
      </div>
    </Modal>
  );
}

function ResetPasswordModal({ employee, onClose }: { employee: User | null; onClose: () => void }) {
  const { toast } = useStore();
  const [password, setPassword] = useState(() => tempPassword());
  const [busy, setBusy] = useState(false);
  if (!employee) return null;

  const reset = async () => {
    if (password.length < 8) { toast("Temporary password must be at least 8 characters", "err"); return; }
    setBusy(true);
    try {
      await api.post(`/users/${employee.id}/reset-password`, { password });
      mutate((db) => {
        const u = db.users.find((x) => x.id === employee.id) as SecureUser | undefined;
        if (u) u.mustChangePassword = true;
      });
      toast("Employee password reset", "ok", `${employee.email} · temporary password: ${password}`);
      onClose();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not reset password", "err");
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    try { await navigator.clipboard.writeText(password); toast("Temporary password copied", "ok"); }
    catch { toast("Copy failed — select and copy the password manually", "warn"); }
  };

  return (
    <Modal open={!!employee} onClose={onClose} title="Reset employee password" footer={
      <><Btn variant="ghost" onClick={onClose}>Cancel</Btn><Btn loading={busy} onClick={() => void reset()}><KeyRound size={14} /> Reset password</Btn></>
    }>
      <p className="mb-4 text-[13px] leading-relaxed text-ink-600 dark:text-ink-300">Set a temporary password for <strong>{employee.name}</strong>. All existing refresh sessions will be revoked and the employee must change this password at the next login.</p>
      <Field label="Temporary password" req>
        <div className="flex gap-2"><Input value={password} onChange={(e) => setPassword(e.target.value)} /><Btn type="button" variant="outline" onClick={() => void copy()}><Copy size={14} /> Copy</Btn></div>
      </Field>
      <div className="mt-3 flex flex-wrap gap-2"><Btn size="xs" variant="soft" onClick={() => setPassword(tempPassword())}>Generate another</Btn><span className="self-center text-[11px] text-ink-400">Minimum 8 characters.</span></div>
    </Modal>
  );
}

export default function EmployeeManagement() {
  const { user, can, toast } = useStore();
  const d = useDB();
  const nav = useNavigate();
  const [q, setQ] = useState("");
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<User | null>(null);
  const [deleting, setDeleting] = useState<User | null>(null);
  const [resetting, setResetting] = useState<User | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const employees = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return d.users;
    return d.users.filter((u) => {
      const role = d.roles.find((r) => r.id === u.roleId)?.name || "";
      const team = d.teams.find((t) => t.id === u.teamId)?.name || "";
      return `${u.name} ${u.email} ${u.phone} ${role} ${team}`.toLowerCase().includes(needle);
    });
  }, [d.users, d.roles, d.teams, q]);

  const setActive = async (employee: User, active: boolean) => {
    setBusyId(employee.id);
    try {
      if (!DEMO_MODE) await api.patch(`/users/${employee.id}`, { active });
      mutate((db) => { const u = db.users.find((x) => x.id === employee.id); if (u) u.active = active; });
      toast(active ? "Employee enabled" : "Employee disabled", active ? "ok" : "warn", employee.email);
    } catch (e) { toast(e instanceof Error ? e.message : "Could not update employee", "err"); }
    finally { setBusyId(null); }
  };

  const removeEmployee = async () => {
    if (!deleting) return;
    setBusyId(deleting.id);
    try {
      if (!DEMO_MODE) await api.delete(`/users/${deleting.id}`);
      mutate((db) => {
        db.users = db.users.filter((u) => u.id !== deleting.id);
        db.teams.forEach((t) => { t.memberIds = t.memberIds.filter((id) => id !== deleting.id); });
      });
      toast("Employee removed", "ok", deleting.email);
      setDeleting(null);
    } catch (e) { toast(e instanceof Error ? e.message : "Could not remove employee", "err"); }
    finally { setBusyId(null); }
  };

  const roleName = (u: User) => d.roles.find((r) => r.id === u.roleId)?.name || "No role";
  const teamName = (u: User) => d.teams.find((t) => t.id === u.teamId)?.name || "—";
  const needsPassword = (u: User) => !!(u as SecureUser).mustChangePassword;

  return (
    <div className="mx-auto max-w-[1250px] p-4 md:p-6">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="hd flex items-center gap-2 text-[22px]"><Users size={20} /> Employee Management</h1>
          <p className="mt-0.5 text-[12.5px] text-ink-500">Add, edit, open profiles, reset passwords, enable/disable and remove employees.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Btn variant="outline" size="sm" onClick={() => nav(`/profile/${user!.id}`)}><Eye size={14} /> My profile</Btn>
          <Btn variant="outline" size="sm" onClick={() => nav("/access-settings")}><Settings2 size={14} /> Roles & Teams</Btn>
          {can("employees", "create") && <Btn size="sm" onClick={() => setAdding(true)}><Plus size={14} /> Add employee</Btn>}
        </div>
      </div>

      <div className="mb-4 flex flex-col gap-3 rounded-lg border border-ink-200/80 bg-surface p-3 dark:border-ink-700 dark:bg-ink-900 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search employee, email, role, team..." className="pl-9" />
        </div>
        <div className="flex flex-wrap gap-2 text-[11.5px] text-ink-500">
          <Badge tone="green">{d.users.filter((u) => u.active).length} active</Badge>
          <Badge tone="slate">{d.users.length} total</Badge>
        </div>
      </div>

      <div className="space-y-3 md:hidden">
        {employees.map((u) => (
          <div key={u.id} className="card p-4">
            <button onClick={() => nav(`/profile/${u.id}`)} className="flex w-full items-start justify-between gap-3 text-left">
              <div className="flex min-w-0 items-center gap-3"><Avatar name={u.name} color={u.color} size={36} /><div className="min-w-0"><div className="truncate font-semibold text-ink-900 dark:text-ink-50">{u.name}</div><div className="truncate text-[11px] text-ink-400">{u.email}</div></div></div>
              <div className="flex flex-col items-end gap-1"><Badge tone={u.active ? "green" : "red"}>{u.active ? "Active" : "Disabled"}</Badge>{needsPassword(u) && <Badge tone="amber">Password change</Badge>}</div>
            </button>
            <div className="mt-3 grid grid-cols-2 gap-2 text-[12px]">
              <div><span className="text-ink-400">Role</span><div className="font-medium">{roleName(u)}</div></div>
              <div><span className="text-ink-400">Team</span><div className="font-medium">{teamName(u)}</div></div>
              <div><span className="text-ink-400">Phone</span><div className="font-medium">{u.phone || "—"}</div></div>
              <div><span className="text-ink-400">Last login</span><div className="font-medium">{u.lastLogin ? fmtDT(u.lastLogin) : "Never"}</div></div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <Btn size="xs" variant="soft" onClick={() => nav(`/profile/${u.id}`)}><Eye size={12} /> Profile</Btn>
              {u.id !== user!.id && <>
                {can("employees", "edit") && <Btn size="xs" variant="outline" onClick={() => setEditing(u)}><Pencil size={12} /> Edit</Btn>}
                {can("employees", "edit") && <Btn size="xs" variant="outline" onClick={() => setResetting(u)}><KeyRound size={12} /> Reset password</Btn>}
                {can("employees", "edit") && <Btn size="xs" variant={u.active ? "ghost" : "soft"} disabled={busyId === u.id} onClick={() => void setActive(u, !u.active)}>{u.active ? <UserX size={12} /> : <UserCheck size={12} />}{u.active ? "Disable" : "Enable"}</Btn>}
                {can("employees", "delete") && <Btn size="xs" variant="danger" onClick={() => setDeleting(u)}><Trash2 size={12} /> Remove</Btn>}
              </>}
            </div>
          </div>
        ))}
      </div>

      <div className="card hidden overflow-hidden md:block">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px]">
            <thead className="border-b border-ink-200/70 bg-ink-50/70 dark:border-ink-700 dark:bg-ink-800/50"><tr><th className="th">Employee</th><th className="th">Role</th><th className="th">Team</th><th className="th">Phone</th><th className="th">Last login</th><th className="th">Status</th><th className="th text-right">Actions</th></tr></thead>
            <tbody>{employees.map((u) => (
              <tr key={u.id} className="border-b border-ink-100/70 dark:border-ink-800">
                <td className="td"><button onClick={() => nav(`/profile/${u.id}`)} className="flex items-center gap-2.5 text-left hover:text-brand-600"><Avatar name={u.name} color={u.color} size={30} /><span><span className="block font-semibold text-ink-900 dark:text-ink-50">{u.name}</span><span className="block text-[11px] text-ink-400">{u.email}</span></span></button></td>
                <td className="td"><Badge tone="violet">{roleName(u)}</Badge></td>
                <td className="td text-[12px]">{teamName(u)}</td>
                <td className="td text-[12px]">{u.phone || "—"}</td>
                <td className="td text-[11.5px] text-ink-400">{u.lastLogin ? fmtDT(u.lastLogin) : "Never"}</td>
                <td className="td"><div className="flex flex-col items-start gap-1"><Badge tone={u.active ? "green" : "red"}>{u.active ? "Active" : "Disabled"}</Badge>{needsPassword(u) && <Badge tone="amber">Password change</Badge>}</div></td>
                <td className="td"><div className="flex justify-end gap-1.5">
                  <Btn size="xs" variant="soft" onClick={() => nav(`/profile/${u.id}`)}><Eye size={12} /> Profile</Btn>
                  {u.id === user!.id ? <Badge tone="blue">Current user</Badge> : <>
                    {can("employees", "edit") && <Btn size="xs" variant="outline" onClick={() => setEditing(u)}><Pencil size={12} /> Edit</Btn>}
                    {can("employees", "edit") && <Btn size="xs" variant="outline" onClick={() => setResetting(u)}><KeyRound size={12} /> Reset</Btn>}
                    {can("employees", "edit") && <Btn size="xs" variant={u.active ? "ghost" : "soft"} disabled={busyId === u.id} onClick={() => void setActive(u, !u.active)}>{u.active ? "Disable" : "Enable"}</Btn>}
                    {can("employees", "delete") && <Btn size="xs" variant="danger" onClick={() => setDeleting(u)}><Trash2 size={12} /> Remove</Btn>}
                  </>}
                </div></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </div>

      {!employees.length && <div className="card py-12 text-center text-[13px] text-ink-500">No employees match your search.</div>}

      {adding && <EmployeeEditor key="new" open={adding} employee={null} onClose={() => setAdding(false)} />}
      {editing && <EmployeeEditor key={editing.id} open={!!editing} employee={editing} onClose={() => setEditing(null)} />}
      <ResetPasswordModal employee={resetting} onClose={() => setResetting(null)} />
      <Modal open={!!deleting} onClose={() => setDeleting(null)} title="Remove employee" footer={
        <><Btn variant="ghost" onClick={() => setDeleting(null)}>Cancel</Btn><Btn variant="danger" loading={busyId === deleting?.id} onClick={() => void removeEmployee()}>Remove employee</Btn></>
      }>
        <p className="text-[13px] leading-relaxed text-ink-600 dark:text-ink-300">This will disable and soft-delete <strong>{deleting?.name}</strong> from the CRM. Their historical CRM records remain in PostgreSQL for audit/history, but the employee will no longer be able to sign in.</p>
      </Modal>
    </div>
  );
}
