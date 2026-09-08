import { useEffect, useMemo, useState } from "react";
import { Building2, ChevronRight, Mail, Pencil, Phone, Plus, Search, Trash2, Users } from "lucide-react";
import { api, DEMO_MODE } from "../lib/api";
import { useDB } from "../lib/db";
import { useStore } from "../store";
import { Avatar, Badge, Btn, Field, Input, Modal, Textarea, Toggle } from "../components/ui";

type Department = {
  id: number;
  name: string;
  description: string;
  allowed_role_ids: number[];
  active: boolean;
  member_count: number;
};

type DepartmentMember = {
  id: number | string;
  name: string;
  email: string;
  phone: string;
  department: string;
  designation: string;
  role_id: number | string;
  team_id?: number | string | null;
  role_name?: string;
  team_name?: string;
  active: boolean;
  color: string;
  last_login_at?: string | null;
};

type FormState = { name: string; description: string; allowedRoleIds: number[]; active: boolean };
const blank = (): FormState => ({ name: "", description: "", allowedRoleIds: [], active: true });

export default function DepartmentsV2() {
  const { can, toast } = useStore();
  const d = useDB();
  const [rows, setRows] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [modal, setModal] = useState(false);
  const [editing, setEditing] = useState<Department | null>(null);
  const [form, setForm] = useState<FormState>(blank());
  const [busy, setBusy] = useState(false);
  const [memberDepartment, setMemberDepartment] = useState<Department | null>(null);
  const [members, setMembers] = useState<DepartmentMember[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);

  const load = async () => {
    if (DEMO_MODE) {
      setRows([
        { id: 1, name: "Sales", description: "Sales, lead generation and revenue", allowed_role_ids: [], active: true, member_count: d.users.filter((u) => u.isSales).length },
        { id: 2, name: "Operations", description: "Operations and delivery", allowed_role_ids: [], active: true, member_count: d.users.filter((u) => !u.isSales).length },
      ]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const r = await api.get<Department[]>("/departments");
      setRows(r.data);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not load departments", "err");
    } finally { setLoading(false); }
  };

  useEffect(() => { void load(); }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? rows.filter((x) => `${x.name} ${x.description}`.toLowerCase().includes(q)) : rows;
  }, [rows, query]);

  const openAdd = () => {
    if (!can("employees", "create")) { toast("You do not have permission to add departments", "warn"); return; }
    setEditing(null); setForm(blank()); setModal(true);
  };

  const openEdit = (row: Department) => {
    if (!can("employees", "edit")) { toast("You can view this department, but you cannot edit it", "warn"); return; }
    setEditing(row);
    setForm({ name: row.name, description: row.description || "", allowedRoleIds: (row.allowed_role_ids || []).map(Number), active: row.active !== false });
    setModal(true);
  };

  const openMembers = async (row: Department) => {
    setMemberDepartment(row);
    setMembers([]);
    setMembersLoading(true);
    try {
      if (DEMO_MODE) {
        const demoUsers = d.users
          .filter((u) => row.name === "Sales" ? u.isSales : !u.isSales)
          .map((u) => ({
            id: u.id,
            name: u.name,
            email: u.email,
            phone: u.phone,
            department: row.name,
            designation: "",
            role_id: u.roleId,
            role_name: d.roles.find((r) => r.id === u.roleId)?.name || "",
            team_name: d.teams.find((t) => t.id === u.teamId)?.name || "",
            active: u.active,
            color: u.color,
            last_login_at: u.lastLogin || null,
          }));
        setMembers(demoUsers);
        return;
      }
      const r = await api.get<DepartmentMember[]>(`/departments/${row.id}/employees`);
      setMembers(r.data || []);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not load department employees", "err");
    } finally { setMembersLoading(false); }
  };

  const toggleRole = (id: number) => setForm((p) => ({
    ...p,
    allowedRoleIds: p.allowedRoleIds.includes(id) ? p.allowedRoleIds.filter((x) => x !== id) : [...p.allowedRoleIds, id],
  }));

  const save = async () => {
    if (!form.name.trim()) { toast("Department name is required", "err"); return; }
    if (DEMO_MODE) { toast("Department administration requires the backend workspace", "warn"); return; }
    setBusy(true);
    try {
      const body = { name: form.name.trim(), description: form.description.trim(), allowed_role_ids: form.allowedRoleIds, active: form.active };
      if (editing) await api.patch(`/departments/${editing.id}`, body); else await api.post("/departments", body);
      toast(editing ? "Department details updated" : "Department added", "ok");
      setModal(false); setEditing(null); await load();
    } catch (e) { toast(e instanceof Error ? e.message : "Could not save department", "err"); }
    finally { setBusy(false); }
  };

  const remove = async (row: Department) => {
    if (!can("employees", "delete")) { toast("You do not have permission to delete departments", "warn"); return; }
    if (!window.confirm(`Delete ${row.name}? Employees must be moved out first.`)) return;
    try {
      await api.delete(`/departments/${row.id}`); toast("Department deleted", "ok"); await load();
    } catch (e) { toast(e instanceof Error ? e.message : "Could not delete department", "err"); }
  };

  const roleName = (id: number | string, fallback?: string) => fallback || d.roles.find((r) => Number(r.id) === Number(id))?.name || `Role #${id}`;

  return (
    <div className="mx-auto max-w-[1200px] p-3 sm:p-4 md:p-6">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="hd flex items-center gap-2 text-[22px]"><Building2 size={20} /> Departments</h1>
          <p className="mt-1 text-[12.5px] text-ink-500">Add departments, edit department details, view members, and control department-wise role access.</p>
        </div>
        <Btn size="sm" className="w-full sm:w-auto" onClick={openAdd}><Plus size={14} /> Add Department</Btn>
      </div>

      <div className="mb-4 flex flex-col gap-2 rounded-lg border border-ink-200/80 bg-surface p-3 dark:border-ink-700 dark:bg-ink-900 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
          <Input className="pl-9" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search departments..." />
        </div>
        <Badge tone="green" className="self-start sm:self-auto">{rows.length} departments</Badge>
      </div>

      {loading ? <div className="card p-8 text-center text-[13px] text-ink-500">Loading departments…</div> : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((row) => (
            <div key={row.id} className="card overflow-hidden">
              <div className="border-b border-ink-100 p-4 dark:border-ink-800">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="hd truncate text-[16px]">{row.name}</h2>
                      <Badge tone={row.active ? "green" : "red"}>{row.active ? "Active" : "Disabled"}</Badge>
                    </div>
                    <p className="mt-1 min-h-9 text-[12px] leading-relaxed text-ink-500">{row.description || "No description added."}</p>
                  </div>
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-700 dark:bg-brand-900/30 dark:text-brand-300"><Building2 size={18} /></span>
                </div>
              </div>

              <div className="p-4">
                <button
                  type="button"
                  onClick={() => void openMembers(row)}
                  className="group flex w-full flex-col gap-2 rounded-lg border border-ink-100 bg-ink-50 p-2.5 text-left transition hover:border-brand-300 hover:bg-brand-50/70 dark:border-ink-800 dark:bg-ink-800/50 dark:hover:border-brand-700 dark:hover:bg-brand-900/20 sm:flex-row sm:items-center"
                  aria-label={`View employees in ${row.name}`}
                >
                  <span className="flex items-center gap-2">
                    <Users size={15} className="text-ink-400" />
                    <strong className="num text-[13px]">{row.member_count || 0}</strong>
                    <span className="text-[11.5px] text-ink-500">employee{row.member_count === 1 ? "" : "s"}</span>
                  </span>
                  <span className="flex w-full items-center justify-center gap-1 rounded-md bg-brand-600 px-3 py-2 text-[11px] font-semibold text-white shadow-sm transition group-hover:bg-brand-700 sm:ml-auto sm:w-auto">
                    View Employees <ChevronRight size={13} />
                  </span>
                </button>

                <div className="mt-3">
                  <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.12em] text-ink-400">Allowed roles</div>
                  <div className="flex flex-wrap gap-1.5">
                    {(row.allowed_role_ids || []).length === 0 ? <Badge tone="green">All roles allowed</Badge> : row.allowed_role_ids.map((id) => <Badge key={id} tone="amber">{roleName(Number(id))}</Badge>)}
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-1 gap-2 border-t border-ink-100 pt-3 dark:border-ink-800 sm:flex sm:flex-wrap sm:justify-end">
                  <Btn size="xs" variant="outline" className="w-full sm:w-auto" onClick={() => openEdit(row)}><Pencil size={12} /> Edit Department Details</Btn>
                  {can("employees", "delete") && <Btn size="xs" variant="ghost" className="w-full sm:w-auto" onClick={() => void remove(row)}><Trash2 size={12} /> Delete</Btn>}
                </div>
              </div>
            </div>
          ))}
          {filtered.length === 0 && <div className="card col-span-full p-10 text-center text-[13px] text-ink-500">No departments found. Use <strong>Add Department</strong> to create one.</div>}
        </div>
      )}

      {memberDepartment && (
        <Modal open wide onClose={() => setMemberDepartment(null)} title={`${memberDepartment.name} · Employees`}>
          <div className="mb-3 flex flex-col gap-2 rounded-lg border border-ink-100 bg-ink-50/70 px-3 py-2.5 dark:border-ink-800 dark:bg-ink-800/40 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-[12.5px] font-semibold text-ink-800 dark:text-ink-100">Department members</div>
              <div className="text-[11px] text-ink-400">Employees currently assigned to {memberDepartment.name}</div>
            </div>
            <Badge tone="green" className="self-start sm:self-auto">{membersLoading ? "Loading…" : `${members.length} employee${members.length === 1 ? "" : "s"}`}</Badge>
          </div>

          {membersLoading ? (
            <div className="py-10 text-center text-[13px] text-ink-400">Loading employees…</div>
          ) : members.length === 0 ? (
            <div className="rounded-lg border border-dashed border-ink-200 p-8 text-center dark:border-ink-700">
              <Users size={24} className="mx-auto mb-2 text-ink-300" />
              <div className="text-[13px] font-semibold text-ink-600 dark:text-ink-300">No employees found</div>
              <div className="mt-1 text-[11.5px] text-ink-400">No employee record is currently assigned to this department.</div>
            </div>
          ) : (
            <div className="max-h-[460px] space-y-2 overflow-y-auto pr-1">
              {members.map((m) => (
                <div key={String(m.id)} className="rounded-lg border border-ink-100 p-3 dark:border-ink-800">
                  <div className="flex items-start gap-3">
                    <Avatar name={m.name} color={m.color || "#0F766E"} size={36} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="truncate text-[13.5px] font-bold text-ink-800 dark:text-ink-100">{m.name}</div>
                        <Badge tone={m.active ? "green" : "red"}>{m.active ? "Active" : "Inactive"}</Badge>
                      </div>
                      <div className="mt-0.5 text-[11.5px] text-ink-500">
                        {m.designation || "No designation"} · <span className="font-semibold">{roleName(m.role_id, m.role_name)}</span>
                        {m.team_name ? <> · {m.team_name}</> : null}
                      </div>
                      <div className="mt-2 grid gap-1 text-[11px] text-ink-400 sm:grid-cols-2">
                        {m.email && <span className="flex min-w-0 items-start gap-1"><Mail size={11} className="mt-0.5 shrink-0" /><span className="break-all">{m.email}</span></span>}
                        {m.phone && <span className="flex items-center gap-1"><Phone size={11} /> {m.phone}</span>}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Modal>
      )}

      {modal && (
        <Modal open wide onClose={() => !busy && setModal(false)} title={editing ? "Edit Department Details" : "Add Department"} footer={
          <><Btn variant="ghost" onClick={() => setModal(false)}>Cancel</Btn><Btn loading={busy} onClick={() => void save()}>{editing ? "Save Department" : "Add Department"}</Btn></>
        }>
          <div className="grid gap-4">
            <Field label="Department name" req><Input value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} placeholder="e.g. Sales" /></Field>
            <Field label="Department details"><Textarea value={form.description} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} placeholder="Department responsibilities, scope and notes" /></Field>
            <Field label="Department-wise role access">
              <p className="mb-2 text-[11.5px] text-ink-500">Choose roles allowed in this department. Leave all roles unselected to allow every role.</p>
              <div className="flex flex-wrap gap-2 rounded-lg border border-ink-200 p-3 dark:border-ink-700">
                {d.roles.map((role) => {
                  const id = Number(role.id); const on = form.allowedRoleIds.includes(id);
                  return <button key={role.id} type="button" onClick={() => toggleRole(id)} className={`rounded-full border px-3 py-1.5 text-[11.5px] font-semibold transition ${on ? "border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-900/30 dark:text-brand-200" : "border-ink-200 text-ink-500 hover:border-brand-300 dark:border-ink-700"}`}>{role.name}</button>;
                })}
              </div>
            </Field>
            <Toggle on={form.active} onChange={(active) => setForm((p) => ({ ...p, active }))} label={form.active ? "Department active" : "Department disabled"} />
          </div>
        </Modal>
      )}
    </div>
  );
}
