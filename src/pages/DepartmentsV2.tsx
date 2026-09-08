import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle, Building2, ChevronRight, Mail, Pencil, Phone, Plus,
  Search, ShieldCheck, Trash2, UserMinus, UserPlus, Users,
} from "lucide-react";
import { api, DEMO_MODE } from "../lib/api";
import { useStore } from "../store";
import { Avatar, Badge, Btn, Field, Input, Modal, Textarea, Toggle } from "../components/ui";

type Department = {
  id: number;
  name: string;
  description: string;
  allowed_role_ids: number[];
  active: boolean;
  member_count: number;
  system_key?: string | null;
  system?: boolean;
  sort_order?: number;
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
  access_level?: number;
  role_name?: string;
  team_name?: string;
  active: boolean;
  color: string;
  last_login_at?: string | null;
};

type FormState = { name: string; description: string; active: boolean };
const blank = (): FormState => ({ name: "", description: "", active: true });

const DEMO_CATALOG: Department[] = [
  [1, "Executive Management", "Company vision and growth strategy ko lead karna, including high-value partnerships and investment decisions."],
  [2, "HR & People Department", "Hiring process ko structured banana aur complete employee lifecycle manage karna."],
  [3, "Finance & Accounts", "Expenses control, revenue tracking aur budget adherence manage karna."],
  [4, "Sales & Business Development", "Qualified leads generate karna aur revenue engine ko system-driven banana."],
  [5, "Marketing & Growth", "Inbound lead flow, brand visibility, content aur ads manage karna."],
  [6, "Project Management (PMO)", "Sales handover se delivery tak SOP-compliant project execution manage karna."],
  [7, "Web & Software Engineering", "High-quality technology tools with mandatory security and performance standards."],
  [8, "AI & Automation", "AI-first objective aur repetitive work automation drive karna."],
  [9, "UI/UX & Design", "Visual quality, user experience aur design systems maintain karna."],
  [10, "QA & Testing", "Bug-free delivery aur final QA sign-off ensure karna."],
  [11, "DevOps & IT Infrastructure", "System uptime aur secure deployment pipelines manage karna."],
  [12, "Cybersecurity", "ITCYBER aur client data ko threats se protect karna."],
  [13, "Customer Success", "Client retention aur upsell opportunities improve karna."],
  [14, "Admin & Procurement", "Office assets aur vendor relationships manage karna."],
].map(([id, name, description]) => ({
  id: Number(id), name: String(name), description: String(description), allowed_role_ids: [], active: true,
  member_count: 0, system_key: String(name).toLowerCase().replace(/[^a-z0-9]+/g, "-"), system: true, sort_order: Number(id),
}));

const accessCode = (value?: number) => {
  const n = Number(value || 5);
  return Number.isInteger(n) && n >= 1 && n <= 6 ? `L${n}` : "L5";
};

export default function DepartmentsV2() {
  const { can, toast } = useStore();
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
  const [memberBusyId, setMemberBusyId] = useState<string | null>(null);

  const [candidateOpen, setCandidateOpen] = useState(false);
  const [candidates, setCandidates] = useState<DepartmentMember[]>([]);
  const [candidateLoading, setCandidateLoading] = useState(false);
  const [candidateQuery, setCandidateQuery] = useState("");

  const load = async () => {
    if (DEMO_MODE) {
      setRows(DEMO_CATALOG);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const r = await api.get<Department[]>("/departments");
      setRows(r.data || []);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not load departments", "err");
    } finally { setLoading(false); }
  };

  useEffect(() => { void load(); }, []);

  const approved = useMemo(() => rows.filter((x) => !!x.system), [rows]);
  const legacyCustom = useMemo(() => rows.filter((x) => !x.system), [rows]);
  const totalMembers = useMemo(() => rows.reduce((n, x) => n + Number(x.member_count || 0), 0), [rows]);

  const filterRows = (input: Department[]) => {
    const q = query.trim().toLowerCase();
    if (!q) return input;
    return input.filter((x) => `${x.name} ${x.description}`.toLowerCase().includes(q));
  };
  const approvedFiltered = useMemo(() => filterRows(approved), [approved, query]);
  const legacyFiltered = useMemo(() => filterRows(legacyCustom), [legacyCustom, query]);

  const candidateFiltered = useMemo(() => {
    const q = candidateQuery.trim().toLowerCase();
    if (!q) return candidates;
    return candidates.filter((x) => `${x.name} ${x.email} ${x.phone} ${x.department} ${x.role_name || ""} ${x.team_name || ""} ${accessCode(x.access_level)}`.toLowerCase().includes(q));
  }, [candidates, candidateQuery]);

  const openAdd = () => {
    if (!can("employees", "create")) { toast("You do not have permission to add a custom department", "warn"); return; }
    setEditing(null); setForm(blank()); setModal(true);
  };

  const openEdit = (row: Department) => {
    if (row.system) { toast("Approved Workforce OS department details are locked to the specification", "warn"); return; }
    if (!can("employees", "edit")) { toast("You can view this department, but you cannot edit it", "warn"); return; }
    setEditing(row);
    setForm({ name: row.name, description: row.description || "", active: row.active !== false });
    setModal(true);
  };

  const fetchMembers = async (row: Department) => {
    setMembersLoading(true);
    try {
      if (DEMO_MODE) { setMembers([]); return; }
      const r = await api.get<DepartmentMember[]>(`/departments/${row.id}/employees`);
      setMembers(r.data || []);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not load department employees", "err");
    } finally { setMembersLoading(false); }
  };

  const openMembers = async (row: Department) => {
    setMemberDepartment(row);
    setMembers([]);
    setCandidateOpen(false);
    await fetchMembers(row);
  };

  const openCandidatePicker = async () => {
    if (!memberDepartment) return;
    if (!can("employees", "edit")) { toast("You do not have permission to change department members", "warn"); return; }
    if (!memberDepartment.active) { toast("Enable this department before adding employees", "warn"); return; }
    setCandidateOpen(true);
    setCandidateQuery("");
    setCandidates([]);
    setCandidateLoading(true);
    try {
      if (DEMO_MODE) { setCandidates([]); return; }
      const r = await api.get<DepartmentMember[]>(`/departments/${memberDepartment.id}/candidates`);
      setCandidates(r.data || []);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not load available employees", "err");
    } finally { setCandidateLoading(false); }
  };

  const assignCandidate = async (employee: DepartmentMember) => {
    if (!memberDepartment) return;
    if (employee.department?.trim()) {
      const ok = window.confirm(`Move ${employee.name} from ${employee.department} to ${memberDepartment.name}?`);
      if (!ok) return;
    }
    if (DEMO_MODE) { toast("Department membership changes require the backend workspace", "warn"); return; }
    setMemberBusyId(String(employee.id));
    try {
      await api.post(`/departments/${memberDepartment.id}/employees`, { user_id: Number(employee.id) });
      toast(employee.department?.trim() ? "Employee moved" : "Employee added", "ok", `${employee.name} → ${memberDepartment.name}`);
      setCandidates((xs) => xs.filter((x) => String(x.id) !== String(employee.id)));
      await Promise.all([fetchMembers(memberDepartment), load()]);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not add employee to department", "err");
    } finally { setMemberBusyId(null); }
  };

  const removeMember = async (employee: DepartmentMember) => {
    if (!memberDepartment) return;
    if (!can("employees", "edit")) { toast("You do not have permission to change department members", "warn"); return; }
    const ok = window.confirm(`Remove ${employee.name} from ${memberDepartment.name}? Their CRM account will remain active.`);
    if (!ok) return;
    if (DEMO_MODE) { toast("Department membership changes require the backend workspace", "warn"); return; }
    setMemberBusyId(String(employee.id));
    try {
      await api.delete(`/departments/${memberDepartment.id}/employees/${employee.id}`);
      toast("Removed from department", "ok", `${employee.name} is still an employee and can still sign in.`);
      await Promise.all([fetchMembers(memberDepartment), load()]);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not remove employee from department", "err");
    } finally { setMemberBusyId(null); }
  };

  const save = async () => {
    if (!form.name.trim()) { toast("Department name is required", "err"); return; }
    if (DEMO_MODE) { toast("Department administration requires the backend workspace", "warn"); return; }
    setBusy(true);
    try {
      const body = { name: form.name.trim(), description: form.description.trim(), active: form.active };
      if (editing) await api.patch(`/departments/${editing.id}`, body); else await api.post("/departments", body);
      toast(editing ? "Department details updated" : "Custom department added", "ok");
      setModal(false); setEditing(null); await load();
    } catch (e) { toast(e instanceof Error ? e.message : "Could not save department", "err"); }
    finally { setBusy(false); }
  };

  const remove = async (row: Department) => {
    if (row.system) { toast("Approved Workforce OS departments cannot be deleted", "warn"); return; }
    if (!can("employees", "delete")) { toast("You do not have permission to delete departments", "warn"); return; }
    if (!window.confirm(`Delete ${row.name}? Employees must be moved out first.`)) return;
    try {
      await api.delete(`/departments/${row.id}`); toast("Department deleted", "ok"); await load();
    } catch (e) { toast(e instanceof Error ? e.message : "Could not delete department", "err"); }
  };

  const DepartmentCard = ({ row }: { row: Department }) => (
    <div className="card overflow-hidden">
      <div className="border-b border-ink-100 p-4 dark:border-ink-800">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="hd text-[15.5px] leading-snug">{row.name}</h2>
              {row.system ? <Badge tone="green">Workforce OS</Badge> : <Badge tone="amber">Custom / Legacy</Badge>}
              <Badge tone={row.active ? "green" : "red"}>{row.active ? "Active" : "Disabled"}</Badge>
            </div>
          </div>
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-700 dark:bg-brand-900/30 dark:text-brand-300">
            {row.system ? <ShieldCheck size={18} /> : <Building2 size={18} />}
          </span>
        </div>
      </div>

      <div className="p-4">
        <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.12em] text-ink-400">{row.system ? "Strategic Context" : "Department Details"}</div>
        <p className="min-h-[66px] text-[12px] leading-relaxed text-ink-500">{row.description || "No department details added."}</p>

        <button
          type="button"
          onClick={() => void openMembers(row)}
          className="group mt-4 flex w-full flex-col gap-2 rounded-lg border border-ink-100 bg-ink-50 p-2.5 text-left transition hover:border-brand-300 hover:bg-brand-50/70 dark:border-ink-800 dark:bg-ink-800/50 dark:hover:border-brand-700 dark:hover:bg-brand-900/20 sm:flex-row sm:items-center"
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

        {row.system ? (
          <div className="mt-3 rounded-md border border-dashed border-ink-200 px-3 py-2 text-[10.5px] leading-relaxed text-ink-400 dark:border-ink-700">
            Department roles and CRUD permissions are intentionally reserved for <strong>Step 3</strong>.
          </div>
        ) : (
          <div className="mt-4 grid grid-cols-1 gap-2 border-t border-ink-100 pt-3 dark:border-ink-800 sm:flex sm:flex-wrap sm:justify-end">
            <Btn size="xs" variant="outline" className="w-full sm:w-auto" onClick={() => openEdit(row)}><Pencil size={12} /> Edit Department Details</Btn>
            {can("employees", "delete") && <Btn size="xs" variant="ghost" className="w-full sm:w-auto" onClick={() => void remove(row)}><Trash2 size={12} /> Delete</Btn>}
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className="mx-auto max-w-[1280px] p-3 sm:p-4 md:p-6">
      <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <Badge tone="green">Step 2</Badge>
            <span className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-ink-400">Workforce OS Department Catalog</span>
          </div>
          <h1 className="hd flex items-center gap-2 text-[22px]"><Building2 size={20} /> Departments</h1>
          <p className="mt-1 max-w-3xl text-[12.5px] leading-relaxed text-ink-500">
            Approved organizational departments and their strategic context are now the system source of truth. Role mapping is intentionally deferred to the next step.
          </p>
        </div>
        <Btn size="sm" className="w-full lg:w-auto" onClick={openAdd}><Plus size={14} /> Add Department</Btn>
      </div>

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <div className="card p-3.5"><div className="text-[10px] font-bold uppercase tracking-[0.12em] text-ink-400">Approved departments</div><div className="num mt-1 text-[22px] font-bold">{approved.length}</div><div className="text-[10.5px] text-ink-400">Expected catalog: 14</div></div>
        <div className="card p-3.5"><div className="text-[10px] font-bold uppercase tracking-[0.12em] text-ink-400">Assigned employees</div><div className="num mt-1 text-[22px] font-bold">{totalMembers}</div><div className="text-[10.5px] text-ink-400">Across all departments</div></div>
        <div className="card p-3.5"><div className="text-[10px] font-bold uppercase tracking-[0.12em] text-ink-400">Custom / legacy</div><div className="num mt-1 text-[22px] font-bold">{legacyCustom.length}</div><div className="text-[10.5px] text-ink-400">Kept separate from the approved catalog</div></div>
      </div>

      <div className="mb-5 rounded-lg border border-ink-200/80 bg-surface p-3 dark:border-ink-700 dark:bg-ink-900">
        <div className="relative w-full sm:max-w-md">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
          <Input className="pl-9" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search department or strategic context..." />
        </div>
      </div>

      {loading ? <div className="card p-8 text-center text-[13px] text-ink-500">Loading approved department catalog…</div> : (
        <>
          <section>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="hd text-[16px]">Approved Workforce OS Departments</h2>
                <p className="mt-0.5 text-[11px] text-ink-400">System names and strategic context are locked to the approved specification.</p>
              </div>
              <Badge tone={approved.length === 14 ? "green" : "amber"}>{approved.length} / 14 ready</Badge>
            </div>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {approvedFiltered.map((row) => <DepartmentCard key={row.id} row={row} />)}
              {approvedFiltered.length === 0 && <div className="card col-span-full p-10 text-center text-[13px] text-ink-500">No approved department matches your search.</div>}
            </div>
          </section>

          {legacyCustom.length > 0 && (
            <section className="mt-8">
              <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50/70 p-3 dark:border-amber-900/60 dark:bg-amber-950/20">
                <div className="flex items-start gap-2">
                  <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-600" />
                  <div>
                    <h2 className="hd text-[14px] text-amber-900 dark:text-amber-200">Custom & Legacy Departments</h2>
                    <p className="mt-1 text-[11.5px] leading-relaxed text-amber-800/80 dark:text-amber-300/80">
                      These are not part of the approved 14-department catalog. Legacy rows with employees are retained to prevent data loss; move their employees into an approved department before deleting them.
                    </p>
                  </div>
                </div>
              </div>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {legacyFiltered.map((row) => <DepartmentCard key={row.id} row={row} />)}
                {legacyFiltered.length === 0 && <div className="card col-span-full p-8 text-center text-[12.5px] text-ink-400">No custom or legacy department matches your search.</div>}
              </div>
            </section>
          )}
        </>
      )}

      {memberDepartment && (
        <Modal open wide onClose={() => { setMemberDepartment(null); setCandidateOpen(false); }} title={`${memberDepartment.name} · Employees`}>
          <div className="mb-3 flex flex-col gap-3 rounded-lg border border-ink-100 bg-ink-50/70 px-3 py-2.5 dark:border-ink-800 dark:bg-ink-800/40 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-[12.5px] font-semibold text-ink-800 dark:text-ink-100">Department members</div>
              <div className="text-[11px] text-ink-400">Employee level comes from the Step-1 L1–L6 hierarchy.</div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="green">{membersLoading ? "Loading…" : `${members.length} employee${members.length === 1 ? "" : "s"}`}</Badge>
              {can("employees", "edit") && (
                <Btn size="xs" onClick={() => void openCandidatePicker()} disabled={!memberDepartment.active}>
                  <UserPlus size={13} /> Add / Move Employee
                </Btn>
              )}
            </div>
          </div>

          {membersLoading ? (
            <div className="py-10 text-center text-[13px] text-ink-400">Loading employees…</div>
          ) : members.length === 0 ? (
            <div className="rounded-lg border border-dashed border-ink-200 p-8 text-center dark:border-ink-700">
              <Users size={24} className="mx-auto mb-2 text-ink-300" />
              <div className="text-[13px] font-semibold text-ink-600 dark:text-ink-300">No employees found</div>
              <div className="mt-1 text-[11.5px] text-ink-400">No employee is currently assigned to this department.</div>
              {can("employees", "edit") && memberDepartment.active && <Btn size="sm" className="mt-4" onClick={() => void openCandidatePicker()}><UserPlus size={14} /> Add Employee</Btn>}
            </div>
          ) : (
            <div className="max-h-[470px] space-y-2 overflow-y-auto pr-1">
              {members.map((m) => (
                <div key={String(m.id)} className="rounded-lg border border-ink-100 p-3 dark:border-ink-800">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                    <div className="flex min-w-0 flex-1 items-start gap-3">
                      <Avatar name={m.name} color={m.color || "#0F766E"} size={36} />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="truncate text-[13.5px] font-bold text-ink-800 dark:text-ink-100">{m.name}</div>
                          <Badge tone={m.active ? "green" : "red"}>{m.active ? "Active" : "Inactive"}</Badge>
                          <Badge tone="amber">{accessCode(m.access_level)}</Badge>
                        </div>
                        <div className="mt-0.5 text-[11.5px] text-ink-500">
                          {m.designation || "No designation"} · <span className="font-semibold">{m.role_name || "Role not assigned"}</span>
                          {m.team_name ? <> · {m.team_name}</> : null}
                        </div>
                        <div className="mt-2 grid gap-1 text-[11px] text-ink-400 sm:grid-cols-2">
                          {m.email && <span className="flex min-w-0 items-start gap-1"><Mail size={11} className="mt-0.5 shrink-0" /><span className="break-all">{m.email}</span></span>}
                          {m.phone && <span className="flex items-center gap-1"><Phone size={11} /> {m.phone}</span>}
                        </div>
                      </div>
                    </div>
                    {can("employees", "edit") && (
                      <Btn size="xs" variant="outline" className="w-full shrink-0 sm:w-auto" loading={memberBusyId === String(m.id)} onClick={() => void removeMember(m)}>
                        <UserMinus size={12} /> Remove from Department
                      </Btn>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Modal>
      )}

      {candidateOpen && memberDepartment && (
        <Modal open wide onClose={() => !memberBusyId && setCandidateOpen(false)} title={`Add / Move Employee · ${memberDepartment.name}`}>
          <div className="mb-3 rounded-lg border border-brand-100 bg-brand-50/60 p-3 text-[11.5px] text-brand-800 dark:border-brand-900 dark:bg-brand-950/20 dark:text-brand-200">
            Select an existing employee. Moving them changes only their department; their account, role, team, access level and login remain unchanged.
          </div>
          <div className="relative mb-3">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
            <Input className="pl-9" value={candidateQuery} onChange={(e) => setCandidateQuery(e.target.value)} placeholder="Search employee, email, access level or current department..." />
          </div>

          {candidateLoading ? (
            <div className="py-10 text-center text-[13px] text-ink-400">Loading available employees…</div>
          ) : candidateFiltered.length === 0 ? (
            <div className="rounded-lg border border-dashed border-ink-200 p-8 text-center text-[12.5px] text-ink-400 dark:border-ink-700">No other employees available to add.</div>
          ) : (
            <div className="max-h-[430px] space-y-2 overflow-y-auto pr-1">
              {candidateFiltered.map((m) => (
                <div key={String(m.id)} className="rounded-lg border border-ink-100 p-3 dark:border-ink-800">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                    <div className="flex min-w-0 flex-1 items-start gap-3">
                      <Avatar name={m.name} color={m.color || "#0F766E"} size={34} />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="truncate text-[13px] font-bold">{m.name}</div>
                          <Badge tone={m.active ? "green" : "red"}>{m.active ? "Active" : "Inactive"}</Badge>
                          <Badge tone="amber">{accessCode(m.access_level)}</Badge>
                        </div>
                        <div className="mt-0.5 text-[11px] text-ink-500">{m.role_name || "Role not assigned"}{m.team_name ? ` · ${m.team_name}` : ""}</div>
                        <div className="mt-1 text-[10.5px] text-ink-400">{m.department?.trim() ? <>Current department: <strong>{m.department}</strong></> : "Currently unassigned"}</div>
                        {m.email && <div className="mt-1 truncate text-[10.5px] text-ink-400">{m.email}</div>}
                      </div>
                    </div>
                    <Btn size="xs" className="w-full shrink-0 sm:w-auto" loading={memberBusyId === String(m.id)} onClick={() => void assignCandidate(m)}>
                      <UserPlus size={12} /> {m.department?.trim() ? `Move to ${memberDepartment.name}` : `Add to ${memberDepartment.name}`}
                    </Btn>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Modal>
      )}

      {modal && (
        <Modal open wide onClose={() => !busy && setModal(false)} title={editing ? "Edit Department Details" : "Add Department"} footer={
          <><Btn variant="ghost" onClick={() => setModal(false)}>Cancel</Btn><Btn loading={busy} onClick={() => void save()}>{editing ? "Save Department" : "Add Custom Department"}</Btn></>
        }>
          <div className="mb-4 rounded-lg border border-ink-200 bg-ink-50 p-3 text-[11.5px] leading-relaxed text-ink-500 dark:border-ink-700 dark:bg-ink-800/40">
            This form is only for a custom department outside the approved 14-department Workforce OS catalog. Approved system departments are managed from the specification and cannot be renamed or deleted here.
          </div>
          <div className="grid gap-4">
            <Field label="Department name" req><Input value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} placeholder="Custom department name" /></Field>
            <Field label="Department details"><Textarea value={form.description} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} placeholder="Purpose, responsibilities and internal notes" /></Field>
            <Toggle on={form.active} onChange={(active) => setForm((p) => ({ ...p, active }))} label={form.active ? "Department active" : "Department disabled"} />
          </div>
        </Modal>
      )}
    </div>
  );
}
