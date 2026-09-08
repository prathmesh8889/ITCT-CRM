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
  active: boolean;
  color: string;
};

type FormState = {
  name: string;
  description: string;
  allowedRoleIds: number[];
  active: boolean;
};

const emptyForm = (): FormState => ({ name: "", description: "", allowedRoleIds: [], active: true });

export default function Departments() {
  const { can, toast } = useStore();
  const d = useDB();
  const [rows, setRows] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<Department | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [busy, setBusy] = useState(false);
  const [memberDepartment, setMemberDepartment] = useState<Department | null>(null);
  const [members, setMembers] = useState<DepartmentMember[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);

  const load = async () => {
    if (DEMO_MODE) {
      setRows([
        { id: 1, name: "Sales", description: "Sales, lead generation and revenue teams", allowed_role_ids: [], active: true, member_count: d.users.filter((u) => u.isSales).length },
        { id: 2, name: "Operations", description: "Operations and delivery teams", allowed_role_ids: [], active: true, member_count: d.users.filter((u) => !u.isSales).length },
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
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((x) => `${x.name} ${x.description}`.toLowerCase().includes(q));
  }, [rows, query]);

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm());
    setCreating(true);
  };

  const openEdit = (row: Department) => {
    setEditing(row);
    setForm({
      name: row.name,
      description: row.description || "",
      allowedRoleIds: (row.allowed_role_ids || []).map(Number),
      active: row.active !== false,
    });
    setCreating(true);
  };

  const openMembers = async (row: Department) => {
    setMemberDepartment(row);
    setMembers([]);
    setMembersLoading(true);
    try {
      if (DEMO_MODE) {
        const demoUsers = d.users.filter((u) => row.name === "Sales" ? u.isSales : !u.isSales).map((u) => ({
          id: u.id,
          name: u.name,
          email: u.email,
          phone: u.phone,
          department: row.name,
          designation: "",
          role_id: u.roleId,
          active: u.active,
          color: u.color,
        }));
        setMembers(demoUsers);
        return;
      }
      const r = await api.get<DepartmentMember[]>("/users");
      const departmentName = row.name.trim().toLowerCase();
      setMembers((r.data || []).filter((u) => String(u.department || "").trim().toLowerCase() === departmentName));
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not load department employees", "err");
    } finally {
      setMembersLoading(false);
    }
  };

  const toggleRole = (roleId: number) => {
    setForm((p) => ({
      ...p,
      allowedRoleIds: p.allowedRoleIds.includes(roleId)
        ? p.allowedRoleIds.filter((id) => id !== roleId)
        : [...p.allowedRoleIds, roleId],
    }));
  };

  const save = async () => {
    if (!form.name.trim()) { toast("Department name is required", "err"); return; }
    if (DEMO_MODE) { toast("Department administration requires the backend workspace", "warn"); return; }
    setBusy(true);
    try {
      const body = {
        name: form.name.trim(),
        description: form.description.trim(),
        allowed_role_ids: form.allowedRoleIds,
        active: form.active,
      };
      if (editing) await api.patch(`/departments/${editing.id}`, body);
      else await api.post("/departments", body);
      toast(editing ? "Department updated" : "Department created", "ok");
      setCreating(false);
      setEditing(null);
      await load();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not save department", "err");
    } finally { setBusy(false); }
  };

  const remove = async (row: Department) => {
    if (!window.confirm(`Delete ${row.name}? Employees must be moved out first.`)) return;
    if (DEMO_MODE) { toast("Department administration requires the backend workspace", "warn"); return; }
    try {
      await api.delete(`/departments/${row.id}`);
      toast("Department deleted", "ok");
      await load();
    } catch (e) { toast(e instanceof Error ? e.message : "Could not delete department", "err"); }
  };

  const roleName = (id: number | string) => d.roles.find((r) => Number(r.id) === Number(id))?.name || `Role #${id}`;

  return (
    <div className="mx-auto max-w-[1200px] p-4 md:p-6">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="hd flex items-center gap-2 text-[22px]"><Building2 size={20} /> Departments</h1>
          <p className="mt-0.5 text-[12.5px] text-ink-500">Create departments and control which roles can be assigned inside each department.</p>
        </div>
        {can("employees", "create") && <Btn size="sm" onClick={openCreate}><Plus size={14} /> Add department</Btn>}
      </div>

      <div className="mb-4 rounded-lg border border-ink-200/80 bg-surface p-3 dark:border-ink-700 dark:bg-ink-900">
        <div className="relative max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search departments..." className="pl-9" />
        </div>
      </div>

      {loading ? <div className="card p-8 text-center text-[13px] text-ink-500">Loading departments…</div> : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((row) => (
            <div key={row.id} className="card p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="hd truncate text-[16px]">{row.name}</h2>
                    <Badge tone={row.active ? "green" : "red"}>{row.active ? "Active" : "Disabled"}</Badge>
                  </div>
                  <p className="mt-1 min-h-8 text-[12px] leading-relaxed text-ink-500">{row.description || "No description"}</p>
                </div>
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-700 dark:bg-brand-900/30 dark:text-brand-300"><Building2 size={17} /></span>
              </div>

              <button
                type="button"
                onClick={() => void openMembers(row)}
                className="mt-4 flex w-full items-center gap-2 rounded-lg border border-ink-100 bg-ink-50/70 p-2.5 text-left transition hover:border-brand-300 hover:bg-brand-50/60 dark:border-ink-800 dark:bg-ink-800/40 dark:hover:border-brand-700 dark:hover:bg-brand-900/20"
                title={`View ${row.name} employees`}
              >
                <Users size={15} className="text-ink-400" />
                <span className="num text-[13px] font-bold text-ink-700 dark:text-ink-200">{row.member_count || 0}</span>
                <span className="text-[11.5px] text-ink-400">employee{row.member_count === 1 ? "" : "s"}</span>
                <span className="ml-auto flex items-center gap-1 text-[10.5px] font-semibold text-brand-600 dark:text-brand-300">View employees <ChevronRight size={13} /></span>
              </button>

              <div className="mt-4">
                <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.12em] text-ink-400">Allowed roles</div>
                <div className="flex flex-wrap gap-1.5">
                  {(row.allowed_role_ids || []).length === 0
                    ? <Badge tone="green">All roles</Badge>
                    : row.allowed_role_ids.map((id) => <Badge key={id} tone="amber">{roleName(Number(id))}</Badge>)}
                </div>
              </div>

              <div className="mt-4 flex justify-end gap-1 border-t border-ink-100 pt-3 dark:border-ink-800">
                {can("employees", "edit") && <Btn size="xs" variant="outline" onClick={() => openEdit(row)}><Pencil size={12} /> Edit Department Details</Btn>}
                {can("employees", "delete") && <Btn size="xs" variant="ghost" onClick={() => void remove(row)}><Trash2 size={12} /> Delete</Btn>}
              </div>
            </div>
          ))}
          {filtered.length === 0 && <div className="card col-span-full p-8 text-center text-[13px] text-ink-500">No departments found.</div>}
        </div>
      )}

      {memberDepartment && (
        <Modal open onClose={() => setMemberDepartment(null)} title={`${memberDepartment.name} · Employees`} wide>
          <div className="mb-3 flex items-center justify-between rounded-lg border border-ink-100 bg-ink-50/70 px-3 py-2.5 dark:border-ink-800 dark:bg-ink-800/40">
            <div>
              <div className="text-[12.5px] font-semibold text-ink-800 dark:text-ink-100">Department members</div>
              <div className="text-[11px] text-ink-400">Employees currently assigned to {memberDepartment.name}</div>
            </div>
            <Badge tone="green">{membersLoading ? "Loading…" : `${members.length} employee${members.length === 1 ? "" : "s"}`}</Badge>
          </div>

          {membersLoading ? (
            <div className="py-10 text-center text-[13px] text-ink-400">Loading employees…</div>
          ) : members.length === 0 ? (
            <div className="rounded-lg border border-dashed border-ink-200 p-8 text-center dark:border-ink-700">
              <Users size={24} className="mx-auto mb-2 text-ink-300" />
              <div className="text-[13px] font-semibold text-ink-600 dark:text-ink-300">No employees found</div>
              <div className="mt-1 text-[11.5px] text-ink-400">No active employee record is currently assigned to this department.</div>
            </div>
          ) : (
            <div className="max-h-[440px] space-y-2 overflow-y-auto pr-1">
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
                        {m.designation || "No designation"} · <span className="font-semibold">{roleName(m.role_id)}</span>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-ink-400">
                        {m.email && <span className="flex items-center gap-1"><Mail size={11} /> {m.email}</span>}
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

      {creating && (
        <Modal open onClose={() => !busy && setCreating(false)} title={editing ? "Edit department" : "Add department"} wide footer={
          <><Btn variant="ghost" onClick={() => setCreating(false)}>Cancel</Btn><Btn loading={busy} onClick={() => void save()}>{editing ? "Save changes" : "Create department"}</Btn></>
        }>
          <div className="grid gap-4">
            <Field label="Department name" req><Input value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} placeholder="e.g. Sales" /></Field>
            <Field label="Description"><Textarea value={form.description} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} placeholder="What does this department handle?" /></Field>
            <Field label="Department-wise role access">
              <p className="mb-2 text-[11.5px] text-ink-500">Select the roles that employees in this department may use. Leave all unselected to allow every role.</p>
              <div className="flex flex-wrap gap-2 rounded-lg border border-ink-200 p-3 dark:border-ink-700">
                {d.roles.map((role) => {
                  const id = Number(role.id);
                  const on = form.allowedRoleIds.includes(id);
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
