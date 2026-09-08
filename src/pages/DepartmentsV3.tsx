import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Building2, ChevronRight, Mail, Pencil, Phone, Plus, Search, ShieldCheck, Trash2, UserMinus, UserPlus, Users } from "lucide-react";
import { api, DEMO_MODE } from "../lib/api";
import { useStore } from "../store";
import { Avatar, Badge, Btn, Field, Input, Modal, Textarea, Toggle } from "../components/ui";

type WorkforceRole = {
  id: number;
  title: string;
  level: number;
  primary_function: string;
  department_key: string;
  member_count?: number;
};

type Department = {
  id: number;
  name: string;
  description: string;
  active: boolean;
  member_count: number;
  system_key?: string | null;
  system?: boolean;
  sort_order?: number;
  workforce_roles?: WorkforceRole[];
};

type DepartmentMember = {
  id: number;
  name: string;
  email: string;
  phone: string;
  department: string;
  designation: string;
  role_id: number;
  team_id?: number | null;
  access_level?: number;
  role_name?: string;
  team_name?: string;
  role_department_key?: string | null;
  role_department?: string | null;
  role_access_level?: number | null;
  primary_function?: string;
  workforce_role?: boolean;
  active: boolean;
  color: string;
  can_assign?: boolean;
  assignment_reason?: string;
};

type FormState = { name: string; description: string; active: boolean };
const blank = (): FormState => ({ name: "", description: "", active: true });
const levelCode = (n?: number | null) => n && n >= 1 && n <= 6 ? `L${n}` : "—";

export default function DepartmentsV3() {
  const { can, toast } = useStore();
  const [rows, setRows] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<Department | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<FormState>(blank());
  const [busy, setBusy] = useState(false);

  const [memberDepartment, setMemberDepartment] = useState<Department | null>(null);
  const [members, setMembers] = useState<DepartmentMember[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [candidateOpen, setCandidateOpen] = useState(false);
  const [candidates, setCandidates] = useState<DepartmentMember[]>([]);
  const [candidateLoading, setCandidateLoading] = useState(false);
  const [candidateQuery, setCandidateQuery] = useState("");
  const [memberBusyId, setMemberBusyId] = useState<number | null>(null);

  const load = async () => {
    if (DEMO_MODE) { setRows([]); setLoading(false); return; }
    setLoading(true);
    try {
      const r = await api.get<Department[]>("/departments");
      setRows(r.data || []);
    } catch (e) { toast(e instanceof Error ? e.message : "Could not load departments", "err"); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  const approved = useMemo(() => rows.filter((x) => !!x.system), [rows]);
  const custom = useMemo(() => rows.filter((x) => !x.system), [rows]);
  const filter = (xs: Department[]) => {
    const q = query.trim().toLowerCase();
    return q ? xs.filter((x) => `${x.name} ${x.description} ${(x.workforce_roles || []).map((r) => r.title).join(" ")}`.toLowerCase().includes(q)) : xs;
  };
  const approvedFiltered = useMemo(() => filter(approved), [approved, query]);
  const customFiltered = useMemo(() => filter(custom), [custom, query]);
  const totalRoles = useMemo(() => approved.reduce((n, d) => n + (d.workforce_roles || []).length, 0), [approved]);
  const totalMembers = useMemo(() => rows.reduce((n, d) => n + Number(d.member_count || 0), 0), [rows]);

  const openAdd = () => {
    if (!can("employees", "create")) { toast("You do not have permission to add a custom department", "warn"); return; }
    setEditing(null); setForm(blank()); setFormOpen(true);
  };
  const openEdit = (row: Department) => {
    if (row.system) { toast("Approved departments are locked to the Workforce OS specification", "warn"); return; }
    if (!can("employees", "edit")) { toast("You cannot edit this department", "warn"); return; }
    setEditing(row); setForm({ name: row.name, description: row.description || "", active: row.active !== false }); setFormOpen(true);
  };
  const saveDepartment = async () => {
    if (!form.name.trim()) { toast("Department name is required", "err"); return; }
    if (DEMO_MODE) { toast("Department administration requires the backend", "warn"); return; }
    setBusy(true);
    try {
      const body = { name: form.name.trim(), description: form.description.trim(), active: form.active };
      if (editing) await api.patch(`/departments/${editing.id}`, body); else await api.post("/departments", body);
      toast(editing ? "Department updated" : "Custom department added", "ok");
      setFormOpen(false); setEditing(null); await load();
    } catch (e) { toast(e instanceof Error ? e.message : "Could not save department", "err"); }
    finally { setBusy(false); }
  };
  const removeDepartment = async (row: Department) => {
    if (row.system) { toast("Approved Workforce OS departments cannot be deleted", "warn"); return; }
    if (!can("employees", "delete")) { toast("You cannot delete departments", "warn"); return; }
    if (!window.confirm(`Delete ${row.name}? Employees must be moved out first.`)) return;
    try { await api.delete(`/departments/${row.id}`); toast("Department deleted", "ok"); await load(); }
    catch (e) { toast(e instanceof Error ? e.message : "Could not delete department", "err"); }
  };

  const fetchMembers = async (row: Department) => {
    setMembersLoading(true);
    try {
      const r = await api.get<DepartmentMember[]>(`/departments/${row.id}/employees`);
      setMembers(r.data || []);
    } catch (e) { toast(e instanceof Error ? e.message : "Could not load department employees", "err"); }
    finally { setMembersLoading(false); }
  };
  const openMembers = async (row: Department) => {
    setMemberDepartment(row); setMembers([]); setCandidateOpen(false); await fetchMembers(row);
  };
  const openCandidates = async () => {
    if (!memberDepartment) return;
    if (!can("employees", "edit")) { toast("You cannot change department members", "warn"); return; }
    setCandidateOpen(true); setCandidateQuery(""); setCandidateLoading(true); setCandidates([]);
    try {
      const r = await api.get<DepartmentMember[]>(`/departments/${memberDepartment.id}/candidates`);
      setCandidates(r.data || []);
    } catch (e) { toast(e instanceof Error ? e.message : "Could not load employees", "err"); }
    finally { setCandidateLoading(false); }
  };
  const assignCandidate = async (employee: DepartmentMember) => {
    if (!memberDepartment || employee.can_assign === false) return;
    if (employee.department?.trim() && !window.confirm(`Move ${employee.name} from ${employee.department} to ${memberDepartment.name}?`)) return;
    setMemberBusyId(employee.id);
    try {
      await api.post(`/departments/${memberDepartment.id}/employees`, { user_id: employee.id });
      toast(employee.department?.trim() ? "Employee moved" : "Employee added", "ok", `${employee.name} → ${memberDepartment.name}`);
      setCandidates((xs) => xs.filter((x) => x.id !== employee.id));
      await Promise.all([fetchMembers(memberDepartment), load()]);
    } catch (e) { toast(e instanceof Error ? e.message : "Could not move employee", "err"); }
    finally { setMemberBusyId(null); }
  };
  const removeMember = async (employee: DepartmentMember) => {
    if (!memberDepartment) return;
    if (!window.confirm(`Remove ${employee.name} from ${memberDepartment.name}?`)) return;
    setMemberBusyId(employee.id);
    try {
      await api.delete(`/departments/${memberDepartment.id}/employees/${employee.id}`);
      toast("Removed from department", "ok"); await Promise.all([fetchMembers(memberDepartment), load()]);
    } catch (e) { toast(e instanceof Error ? e.message : "Could not remove employee", "err"); }
    finally { setMemberBusyId(null); }
  };

  const candidateFiltered = useMemo(() => {
    const q = candidateQuery.trim().toLowerCase();
    return q ? candidates.filter((x) => `${x.name} ${x.email} ${x.department} ${x.role_name || ""} ${x.assignment_reason || ""}`.toLowerCase().includes(q)) : candidates;
  }, [candidates, candidateQuery]);

  const DepartmentCard = ({ row }: { row: Department }) => (
    <div className="card overflow-hidden">
      <div className="border-b border-ink-100 p-4 dark:border-ink-800">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h2 className="hd text-[15.5px] leading-snug">{row.name}</h2>{row.system ? <Badge tone="green">Workforce OS</Badge> : <Badge tone="amber">Custom / Legacy</Badge>}<Badge tone={row.active ? "green" : "red"}>{row.active ? "Active" : "Disabled"}</Badge></div></div>
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-700 dark:bg-brand-900/30 dark:text-brand-300">{row.system ? <ShieldCheck size={18} /> : <Building2 size={18} />}</span>
        </div>
      </div>
      <div className="p-4">
        <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.12em] text-ink-400">{row.system ? "Strategic Context" : "Department Details"}</div>
        <p className="text-[12px] leading-relaxed text-ink-500">{row.description || "No details added."}</p>

        {row.system && (
          <div className="mt-4 space-y-2">
            <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-ink-400">Approved Roles</div>
            {(row.workforce_roles || []).map((role) => (
              <div key={role.id} className="rounded-lg border border-ink-100 bg-ink-50/70 p-2.5 dark:border-ink-800 dark:bg-ink-800/40">
                <div className="flex items-start gap-2"><Badge tone="amber">L{role.level}</Badge><div className="min-w-0"><div className="text-[12px] font-bold text-ink-800 dark:text-ink-100">{role.title}</div><div className="mt-0.5 text-[10.5px] leading-relaxed text-ink-400">{role.primary_function}</div></div></div>
              </div>
            ))}
          </div>
        )}

        <button type="button" onClick={() => void openMembers(row)} className="group mt-4 flex w-full flex-col gap-2 rounded-lg border border-ink-100 bg-ink-50 p-2.5 text-left transition hover:border-brand-300 hover:bg-brand-50/70 dark:border-ink-800 dark:bg-ink-800/50 sm:flex-row sm:items-center">
          <span className="flex items-center gap-2"><Users size={15} className="text-ink-400" /><strong className="num text-[13px]">{row.member_count || 0}</strong><span className="text-[11.5px] text-ink-500">employee{row.member_count === 1 ? "" : "s"}</span></span>
          <span className="flex w-full items-center justify-center gap-1 rounded-md bg-brand-600 px-3 py-2 text-[11px] font-semibold text-white sm:ml-auto sm:w-auto">View Employees <ChevronRight size={13} /></span>
        </button>

        {!row.system && <div className="mt-4 flex flex-col gap-2 border-t border-ink-100 pt-3 dark:border-ink-800 sm:flex-row sm:justify-end"><Btn size="xs" variant="outline" onClick={() => openEdit(row)}><Pencil size={12} /> Edit Department Details</Btn>{can("employees", "delete") && <Btn size="xs" variant="ghost" onClick={() => void removeDepartment(row)}><Trash2 size={12} /> Delete</Btn>}</div>}
      </div>
    </div>
  );

  return (
    <div className="mx-auto max-w-[1320px] p-3 sm:p-4 md:p-6">
      <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div><div className="mb-1 flex flex-wrap items-center gap-2"><Badge tone="green">Step 3</Badge><span className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-ink-400">Departments + Approved Roles</span></div><h1 className="hd flex items-center gap-2 text-[22px]"><Building2 size={20} /> Departments</h1><p className="mt-1 max-w-3xl text-[12.5px] leading-relaxed text-ink-500">Each approved department now contains the exact L3, L4, L5 and L6 roles defined by the Workforce OS specification. Entity-level CRUD matrices are applied in the next permission step.</p></div>
        <Btn size="sm" className="w-full lg:w-auto" onClick={openAdd}><Plus size={14} /> Add Custom Department</Btn>
      </div>

      <div className="mb-4 grid gap-3 sm:grid-cols-3"><div className="card p-3.5"><div className="text-[10px] font-bold uppercase text-ink-400">Approved departments</div><div className="num mt-1 text-[22px] font-bold">{approved.length}</div><div className="text-[10.5px] text-ink-400">Expected: 14</div></div><div className="card p-3.5"><div className="text-[10px] font-bold uppercase text-ink-400">Approved roles</div><div className="num mt-1 text-[22px] font-bold">{totalRoles}</div><div className="text-[10.5px] text-ink-400">Expected: 56</div></div><div className="card p-3.5"><div className="text-[10px] font-bold uppercase text-ink-400">Assigned employees</div><div className="num mt-1 text-[22px] font-bold">{totalMembers}</div><div className="text-[10.5px] text-ink-400">Across all departments</div></div></div>
      <div className="mb-5 rounded-lg border border-ink-200/80 bg-surface p-3 dark:border-ink-700 dark:bg-ink-900"><div className="relative w-full sm:max-w-md"><Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" /><Input className="pl-9" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search department, role or strategic context..." /></div></div>

      {loading ? <div className="card p-10 text-center text-[13px] text-ink-400">Loading Workforce OS department roles…</div> : <>
        <section><div className="mb-3 flex items-center justify-between gap-2"><div><h2 className="hd text-[16px]">Approved Workforce OS Departments</h2><p className="mt-0.5 text-[11px] text-ink-400">System department names and role identities are locked to the specification.</p></div><Badge tone={approved.length === 14 && totalRoles === 56 ? "green" : "amber"}>{approved.length}/14 · {totalRoles}/56</Badge></div><div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{approvedFiltered.map((row) => <DepartmentCard key={row.id} row={row} />)}{approvedFiltered.length === 0 && <div className="card col-span-full p-10 text-center text-[13px] text-ink-500">No approved department matches your search.</div>}</div></section>
        {custom.length > 0 && <section className="mt-8"><div className="mb-3 rounded-lg border border-amber-200 bg-amber-50/70 p-3 dark:border-amber-900 dark:bg-amber-950/20"><div className="flex items-start gap-2"><AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-600" /><div><h2 className="hd text-[14px]">Custom & Legacy Departments</h2><p className="mt-1 text-[11.5px] text-amber-800/80 dark:text-amber-300/80">These remain only to protect existing data. Approved PDF roles cannot be moved into custom departments.</p></div></div></div><div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{customFiltered.map((row) => <DepartmentCard key={row.id} row={row} />)}</div></section>}
      </>}

      {memberDepartment && <Modal open wide onClose={() => { setMemberDepartment(null); setCandidateOpen(false); }} title={`${memberDepartment.name} · Employees`}>
        <div className="mb-3 flex flex-col gap-3 rounded-lg border border-ink-100 bg-ink-50/70 p-3 dark:border-ink-800 dark:bg-ink-800/40 sm:flex-row sm:items-center sm:justify-between"><div><div className="text-[12.5px] font-semibold">Department members</div><div className="text-[11px] text-ink-400">Approved role, level and department must stay consistent.</div></div><div className="flex items-center gap-2"><Badge tone="green">{membersLoading ? "Loading…" : `${members.length} employees`}</Badge>{can("employees", "edit") && <Btn size="xs" onClick={() => void openCandidates()}><UserPlus size={13} /> Add / Move Employee</Btn>}</div></div>
        {membersLoading ? <div className="py-10 text-center text-[13px] text-ink-400">Loading employees…</div> : members.length === 0 ? <div className="rounded-lg border border-dashed border-ink-200 p-8 text-center dark:border-ink-700"><Users size={24} className="mx-auto mb-2 text-ink-300" /><div className="text-[13px] font-semibold">No employees assigned</div></div> : <div className="max-h-[480px] space-y-2 overflow-y-auto pr-1">{members.map((m) => <div key={m.id} className="rounded-lg border border-ink-100 p-3 dark:border-ink-800"><div className="flex flex-col gap-3 sm:flex-row sm:items-start"><div className="flex min-w-0 flex-1 items-start gap-3"><Avatar name={m.name} color={m.color || "#0F766E"} size={36} /><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><div className="truncate text-[13.5px] font-bold">{m.name}</div><Badge tone={m.active ? "green" : "red"}>{m.active ? "Active" : "Inactive"}</Badge><Badge tone="amber">{levelCode(m.access_level)}</Badge>{m.workforce_role && <Badge tone="green">Approved role</Badge>}</div><div className="mt-1 text-[11.5px] text-ink-500"><strong>{m.role_name || "No role"}</strong>{m.team_name ? ` · ${m.team_name}` : ""}</div>{m.primary_function && <div className="mt-1 text-[10.5px] leading-relaxed text-ink-400">{m.primary_function}</div>}<div className="mt-2 grid gap-1 text-[11px] text-ink-400 sm:grid-cols-2">{m.email && <span className="flex min-w-0 gap-1"><Mail size={11} className="mt-0.5 shrink-0" /><span className="break-all">{m.email}</span></span>}{m.phone && <span className="flex items-center gap-1"><Phone size={11} /> {m.phone}</span>}</div></div></div>{can("employees", "edit") && (!memberDepartment.system || !m.workforce_role) ? <Btn size="xs" variant="outline" loading={memberBusyId === m.id} onClick={() => void removeMember(m)}><UserMinus size={12} /> Remove</Btn> : memberDepartment.system && m.workforce_role ? <Badge tone="slate">Role locks department</Badge> : null}</div></div>)}</div>}
      </Modal>}

      {candidateOpen && memberDepartment && <Modal open wide onClose={() => setCandidateOpen(false)} title={`Add / Move Employee · ${memberDepartment.name}`}>
        <div className="mb-3 rounded-lg border border-brand-100 bg-brand-50/60 p-3 text-[11.5px] text-brand-800 dark:border-brand-900 dark:bg-brand-950/20 dark:text-brand-200">For approved departments, only employees whose approved role belongs to this same department can be moved here. Change mismatched roles from <strong>Employee Management</strong> first.</div>
        <div className="relative mb-3"><Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" /><Input className="pl-9" value={candidateQuery} onChange={(e) => setCandidateQuery(e.target.value)} placeholder="Search employee, role or department..." /></div>
        {candidateLoading ? <div className="py-10 text-center text-[13px] text-ink-400">Loading employees…</div> : <div className="max-h-[440px] space-y-2 overflow-y-auto pr-1">{candidateFiltered.map((m) => <div key={m.id} className="rounded-lg border border-ink-100 p-3 dark:border-ink-800"><div className="flex flex-col gap-3 sm:flex-row sm:items-center"><div className="flex min-w-0 flex-1 items-start gap-3"><Avatar name={m.name} color={m.color || "#0F766E"} size={34} /><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><strong className="text-[13px]">{m.name}</strong><Badge tone="amber">{levelCode(m.access_level)}</Badge>{m.can_assign === false && <Badge tone="red">Role mismatch</Badge>}</div><div className="mt-1 text-[11px] text-ink-500">{m.role_name || "No approved role"} · {m.department || "Unassigned"}</div>{m.assignment_reason && <div className="mt-1 text-[10.5px] text-amber-600">{m.assignment_reason}</div>}</div></div><Btn size="xs" className="w-full sm:w-auto" disabled={m.can_assign === false} loading={memberBusyId === m.id} onClick={() => void assignCandidate(m)}><UserPlus size={12} /> {m.department ? "Move" : "Add"}</Btn></div></div>)}{candidateFiltered.length === 0 && <div className="py-8 text-center text-[12.5px] text-ink-400">No available employees.</div>}</div>}
      </Modal>}

      {formOpen && <Modal open wide onClose={() => !busy && setFormOpen(false)} title={editing ? "Edit Department Details" : "Add Custom Department"} footer={<><Btn variant="ghost" onClick={() => setFormOpen(false)}>Cancel</Btn><Btn loading={busy} onClick={() => void saveDepartment()}>{editing ? "Save Department" : "Add Custom Department"}</Btn></>}><div className="mb-4 rounded-lg border border-ink-200 bg-ink-50 p-3 text-[11.5px] text-ink-500 dark:border-ink-700 dark:bg-ink-800/40">Approved 14 departments and their 56 roles are system-managed and cannot be renamed or redefined here.</div><div className="grid gap-4"><Field label="Department name" req><Input value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} /></Field><Field label="Department details"><Textarea value={form.description} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} /></Field><Toggle on={form.active} onChange={(active) => setForm((p) => ({ ...p, active }))} label={form.active ? "Department active" : "Department disabled"} /></div></Modal>}
    </div>
  );
}
