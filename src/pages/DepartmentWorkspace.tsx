import { useEffect, useState } from "react";
import { Building2, CheckCircle2, Clock3, FolderKanban, Gauge, Pencil, Plus, RefreshCw, ShieldCheck } from "lucide-react";
import { api, DEMO_MODE } from "../lib/api";
import { useStore } from "../store";
import { Badge, Btn, Field, Input, Modal, Select, Textarea } from "../components/ui";

type Access = { label: string; actions: string[]; restrictions: string[] };
type Entity = { key: string; label: string; access_current: Access; extension?: string; credentials?: boolean };
type Employee = { id: number; name: string; email: string; access_level: number; role_name: string };
type Project = { id: number; project_code: string; name: string; description: string; assigned_employee_id: number; assigned_employee_name?: string; assigned_employee_role?: string; status: string; progress: number; start_date?: string | null; due_date?: string | null; last_update?: string };
type InternData = { attendance: { clock_in?: string | null; clock_out?: string | null; daily_report?: string | null } | null; tasks: { id: number; title: string; description: string; priority: string; status: string; due_date?: string | null }[] };
type Workspace = {
  department: { key: string; name: string; strategic_context: string };
  role: { title: string; level: number; primary_function: string };
  level: number;
  entities: Entity[];
  projects: Project[];
  assignable_employees: Employee[];
  available_departments: { key: string; name: string }[];
  intern: InternData | null;
};
type RecordRow = { id: number; title: string; description: string; reference: string; status: string; amount?: number | null; progress: number; due_date?: string | null; assigned_user_id?: number | null; assigned_user_name?: string | null; approved_by_name?: string | null };
type RecordResponse = { rows: RecordRow[]; access: Access };

const d = (v?: string | null) => v ? String(v).slice(0, 10) : "";
const blankRecord = () => ({ title: "", description: "", reference: "", status: "Draft", amount: "", progress: "0", dueDate: "", employeeId: "" });
const blankProject = () => ({ name: "", description: "", employeeId: "", status: "Planned", progress: "0", startDate: "", dueDate: "", lastUpdate: "" });

export default function DepartmentWorkspace() {
  const { toast } = useStore();
  const [ws, setWs] = useState<Workspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [entity, setEntity] = useState<Entity | null>(null);
  const [records, setRecords] = useState<RecordRow[]>([]);
  const [recordOpen, setRecordOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<RecordRow | null>(null);
  const [rf, setRf] = useState(blankRecord());
  const [projectOpen, setProjectOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [pf, setPf] = useState(blankProject());
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState("");

  const load = async (departmentKey = "") => {
    if (DEMO_MODE) { setLoading(false); toast("Department Workspace needs the production backend", "warn"); return; }
    setLoading(true);
    try {
      const q = departmentKey ? `?department_key=${encodeURIComponent(departmentKey)}` : "";
      const r = await api.get<Workspace>(`/workforce/workspace${q}`);
      setWs(r.data);
      setReport(r.data.intern?.attendance?.daily_report || "");
      const readable = r.data.entities.filter((x) => x.access_current.actions.includes("read"));
      const next = readable.find((x) => x.key === entity?.key) || readable[0] || null;
      setEntity(next);
    } catch (e) { toast(e instanceof Error ? e.message : "Could not load department workspace", "err"); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  const loadRecords = async (target = entity) => {
    if (!ws || !target) { setRecords([]); return; }
    try {
      const r = await api.get<RecordResponse>(`/workforce/entities/${target.key}/records?department_key=${encodeURIComponent(ws.department.key)}`);
      setRecords(r.data.rows || []);
    } catch (e) { setRecords([]); toast(e instanceof Error ? e.message : "Could not load service records", "err"); }
  };
  useEffect(() => { if (ws && entity) void loadRecords(entity); }, [ws?.department.key, entity?.key]);

  const allowed = (action: string) => !!entity?.access_current.actions.includes(action);
  const canManageProjects = !!ws && (ws.level <= 4 || ["Super Admin", "Admin"].includes(ws.role.title));
  const hiring = entity?.key === "hiring-pipeline";

  const newRecord = () => { setEditingRecord(null); setRf(blankRecord()); setRecordOpen(true); };
  const editRecord = (row: RecordRow) => {
    setEditingRecord(row);
    setRf({ title: row.title || "", description: row.description || "", reference: row.reference || "", status: row.status || "Draft", amount: row.amount == null ? "" : String(row.amount), progress: String(row.progress || 0), dueDate: d(row.due_date), employeeId: row.assigned_user_id ? String(row.assigned_user_id) : "" });
    setRecordOpen(true);
  };
  const saveRecord = async () => {
    if (!ws || !entity || !rf.title.trim()) { toast("Title is required", "err"); return; }
    setBusy(true);
    try {
      const body = { department_key: ws.department.key, title: rf.title.trim(), description: rf.description.trim(), reference: rf.reference.trim(), status: rf.status, amount: rf.amount, progress: Number(rf.progress || 0), due_date: rf.dueDate || null, assigned_user_id: rf.employeeId ? Number(rf.employeeId) : null };
      if (editingRecord) await api.patch(`/workforce/records/${editingRecord.id}`, body);
      else await api.post(`/workforce/entities/${entity.key}/records`, body);
      toast(editingRecord ? "Service record updated" : "Service record created", "ok");
      setRecordOpen(false); await loadRecords();
    } catch (e) { toast(e instanceof Error ? e.message : "Could not save record", "err"); }
    finally { setBusy(false); }
  };
  const approve = async (row: RecordRow) => {
    if (!window.confirm(`Approve ${row.title}?`)) return;
    try { await api.post(`/workforce/records/${row.id}/approve`, {}); toast("Approved", "ok"); await loadRecords(); }
    catch (e) { toast(e instanceof Error ? e.message : "Could not approve record", "err"); }
  };

  const newProject = () => { setEditingProject(null); setPf(blankProject()); setProjectOpen(true); };
  const editProject = (p: Project) => {
    setEditingProject(p);
    setPf({ name: p.name, description: p.description || "", employeeId: String(p.assigned_employee_id || ""), status: p.status, progress: String(p.progress || 0), startDate: d(p.start_date), dueDate: d(p.due_date), lastUpdate: p.last_update || "" });
    setProjectOpen(true);
  };
  const saveProject = async () => {
    if (!ws || !pf.name.trim()) { toast("Project name is required", "err"); return; }
    if (!editingProject && !pf.employeeId) { toast("Assign an employee", "err"); return; }
    setBusy(true);
    try {
      const body = { department_key: ws.department.key, name: pf.name.trim(), description: pf.description.trim(), assigned_employee_id: pf.employeeId ? Number(pf.employeeId) : undefined, status: pf.status, progress: Number(pf.progress || 0), start_date: pf.startDate || null, due_date: pf.dueDate || null, last_update: pf.lastUpdate.trim() };
      if (editingProject) await api.patch(`/workforce/projects/${editingProject.id}`, body); else await api.post("/workforce/projects", body);
      toast(editingProject ? "Project progress updated" : "Project assigned", "ok"); setProjectOpen(false); await load(ws.department.key);
    } catch (e) { toast(e instanceof Error ? e.message : "Could not save project", "err"); }
    finally { setBusy(false); }
  };

  const internAction = async (action: "clock-in" | "clock-out" | "daily-report") => {
    if (!ws) return; setBusy(true);
    try {
      if (action === "daily-report") await api.post("/workforce/intern/daily-report", { daily_report: report });
      else await api.post(`/workforce/intern/${action}`, {});
      toast(action === "daily-report" ? "Daily Work Report submitted" : action === "clock-in" ? "Clocked in" : "Clocked out", "ok"); await load(ws.department.key);
    } catch (e) { toast(e instanceof Error ? e.message : "Intern action failed", "err"); }
    finally { setBusy(false); }
  };

  if (loading && !ws) return <div className="p-6"><div className="card p-10 text-center text-sm text-ink-400">Loading role workspace…</div></div>;
  if (!ws) return <div className="p-6"><div className="card p-8 text-center text-sm text-ink-500">No approved department workspace is linked to this role.</div></div>;
  const services = ws.entities.filter((x) => x.access_current.actions.includes("read"));

  return <div className="mx-auto max-w-[1380px] p-3 sm:p-4 md:p-6">
    <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
      <div><div className="mb-1 flex gap-2"><Badge tone="violet">L{ws.level}</Badge><Badge tone="green">{ws.role.title}</Badge></div><h1 className="hd flex items-center gap-2 text-[22px]"><Building2 size={21}/>{ws.department.name}</h1><p className="mt-1 max-w-4xl text-[12.5px] text-ink-500">{ws.department.strategic_context}</p><p className="mt-2 text-[11.5px] font-medium">{ws.role.primary_function}</p></div>
      <div className="flex flex-col gap-2 sm:flex-row">{ws.available_departments.length > 1 && <Select value={ws.department.key} onChange={(e) => void load(e.target.value)}>{ws.available_departments.map((x) => <option key={x.key} value={x.key}>{x.name}</option>)}</Select>}<Btn variant="outline" onClick={() => void load(ws.department.key)}><RefreshCw size={13}/>Refresh</Btn></div>
    </div>
    <div className="mb-5 rounded-lg border border-brand-100 bg-brand-50/60 p-3 text-[12px] text-brand-900 dark:border-brand-900 dark:bg-brand-950/20 dark:text-brand-200"><strong>Department-isolated access:</strong> only services allowed by this exact PDF role are visible. Other departments and blocked entities are denied by the backend.</div>

    <section className="mb-6"><h2 className="hd mb-3 text-[17px]">Department Services</h2><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{services.map((x) => <button key={x.key} onClick={() => setEntity(x)} className={`card p-4 text-left transition ${entity?.key === x.key ? "ring-2 ring-brand-500" : "hover:-translate-y-0.5"}`}><div className="font-bold text-[13.5px]">{x.label}</div><div className="mt-2 text-[10.5px] text-ink-500">{x.access_current.label}</div><div className="mt-2 flex flex-wrap gap-1">{x.access_current.actions.map((a) => <Badge key={a} tone={a === "approve" ? "amber" : "slate"}>{a}</Badge>)}</div>{x.extension === "user-request" && <div className="mt-2 text-[9px] font-bold uppercase text-brand-600">Hiring workflow</div>}</button>)}</div></section>

    {entity && <section className="mb-7"><div className="mb-3 flex items-end justify-between gap-3"><div><h2 className="hd text-[17px]">{entity.label}</h2><div className="text-[11px] text-ink-400">{entity.access_current.label}{entity.access_current.restrictions.length ? ` · ${entity.access_current.restrictions.join(", ")}` : ""}</div></div>{allowed("create") && <Btn size="sm" onClick={newRecord}><Plus size={13}/>{hiring ? "Add Candidate" : "Add Record"}</Btn>}</div>
      {records.length === 0 ? <div className="card p-8 text-center text-[12px] text-ink-400">No records yet.</div> : <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{records.map((r) => <div key={r.id} className="card p-4"><div className="flex justify-between gap-2"><strong className="text-[13.5px]">{r.title}</strong><Badge tone={r.status === "Approved" || r.status === "Completed" ? "green" : "slate"}>{r.status}</Badge></div>{r.description && <p className="mt-2 text-[11.5px] text-ink-500">{r.description}</p>}<div className="mt-3 grid grid-cols-2 gap-2 text-[10.5px]">{r.amount != null && <div><span className="text-ink-400">Amount</span><div className="font-semibold">₹{Number(r.amount).toLocaleString("en-IN")}</div></div>}<div><span className="text-ink-400">Progress</span><div className="font-semibold">{r.progress || 0}%</div></div><div><span className="text-ink-400">Assigned</span><div className="font-semibold">{r.assigned_user_name || "—"}</div></div><div><span className="text-ink-400">Due</span><div className="font-semibold">{d(r.due_date) || "—"}</div></div></div><div className="mt-3 h-1.5 rounded-full bg-ink-100 dark:bg-ink-800"><div className="h-full rounded-full bg-brand-500" style={{width:`${Math.max(0,Math.min(100,r.progress||0))}%`}}/></div><div className="mt-3 flex gap-2">{allowed("edit") && <Btn size="xs" variant="outline" onClick={() => editRecord(r)}><Pencil size={11}/>Edit</Btn>}{allowed("approve") && r.status !== "Approved" && <Btn size="xs" onClick={() => void approve(r)}><CheckCircle2 size={11}/>Approve</Btn>}</div></div>)}</div>}
    </section>}

    {ws.level !== 6 && <section className="mb-7"><div className="mb-3 flex items-end justify-between"><div><h2 className="hd flex items-center gap-2 text-[17px]"><FolderKanban size={17}/>Assigned Projects & Progress</h2><p className="text-[11px] text-ink-400">L3 department · L4 team · L5 employee scope.</p></div>{canManageProjects && <Btn size="sm" onClick={newProject}><Plus size={13}/>Assign Project</Btn>}</div>{ws.projects.length === 0 ? <div className="card p-8 text-center text-[12px] text-ink-400">No projects in your scope.</div> : <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{ws.projects.map((p) => <div key={p.id} className="card p-4"><div className="flex justify-between"><div><div className="text-[9px] font-bold text-ink-400">{p.project_code}</div><strong className="text-[13.5px]">{p.name}</strong></div><Badge tone={p.progress >= 100 ? "green" : "blue"}>{p.progress}%</Badge></div><p className="mt-2 text-[11px] text-ink-500">{p.description || "No description"}</p><div className="mt-3 h-2 rounded-full bg-ink-100 dark:bg-ink-800"><div className="h-full rounded-full bg-brand-500" style={{width:`${p.progress}%`}}/></div><div className="mt-3 text-[10.5px]"><b>{p.assigned_employee_name || "—"}</b> · {p.assigned_employee_role || "—"}<br/>Status: {p.status} · Due: {d(p.due_date) || "—"}</div>{p.last_update && <div className="mt-2 rounded bg-ink-50 p-2 text-[10.5px] text-ink-500 dark:bg-ink-800">{p.last_update}</div>}<Btn className="mt-3" size="xs" variant="outline" onClick={() => editProject(p)}><Gauge size={11}/>Update Progress</Btn></div>)}</div>}</section>}

    {ws.level === 6 && ws.intern && <section className="mb-7"><h2 className="hd mb-3 flex items-center gap-2 text-[17px]"><ShieldCheck size={17}/>Restricted Intern Workspace</h2><div className="grid gap-3 lg:grid-cols-2"><div className="card p-4"><h3 className="font-bold text-[13px]"><Clock3 size={14} className="inline mr-1"/>Clock-in / Clock-out</h3><div className="mt-2 text-[11px]">In: {ws.intern.attendance?.clock_in ? new Date(ws.intern.attendance.clock_in).toLocaleTimeString() : "—"} · Out: {ws.intern.attendance?.clock_out ? new Date(ws.intern.attendance.clock_out).toLocaleTimeString() : "—"}</div><div className="mt-3 flex gap-2"><Btn size="sm" disabled={busy || !!ws.intern.attendance?.clock_in} onClick={() => void internAction("clock-in")}>Clock In</Btn><Btn size="sm" variant="outline" disabled={busy || !ws.intern.attendance?.clock_in || !!ws.intern.attendance?.clock_out} onClick={() => void internAction("clock-out")}>Clock Out</Btn></div></div><div className="card p-4"><h3 className="font-bold text-[13px]">Daily Work Report</h3><Textarea className="mt-2" rows={4} value={report} onChange={(e) => setReport(e.target.value)}/><Btn className="mt-2" size="sm" disabled={!report.trim() || busy} onClick={() => void internAction("daily-report")}>Submit Report</Btn></div><div className="card p-4 lg:col-span-2"><h3 className="font-bold text-[13px]">Assigned Micro-Tasks</h3><div className="mt-2 grid gap-2 sm:grid-cols-2">{ws.intern.tasks.map((t) => <div key={t.id} className="rounded border border-ink-100 p-3 dark:border-ink-800"><strong className="text-[12px]">{t.title}</strong><div className="text-[10px] text-ink-400">{t.priority} · {t.status} · {d(t.due_date) || "no due date"}</div></div>)}</div></div></div></section>}

    <Modal open={recordOpen} onClose={() => setRecordOpen(false)} title={editingRecord ? "Edit Service Record" : hiring ? "Add Hiring Candidate" : "Add Service Record"} footer={<><Btn variant="ghost" onClick={() => setRecordOpen(false)}>Cancel</Btn><Btn loading={busy} onClick={() => void saveRecord()}>Save</Btn></>}><div className="grid gap-3 sm:grid-cols-2"><Field label={hiring ? "Candidate name" : "Title"} req><Input value={rf.title} onChange={(e) => setRf({...rf,title:e.target.value})}/></Field><Field label={hiring ? "Role to hire" : "Reference"}><Input value={rf.reference} onChange={(e) => setRf({...rf,reference:e.target.value})}/></Field><Field label={hiring ? "Hiring stage" : "Status"}><Select value={rf.status} onChange={(e) => setRf({...rf,status:e.target.value})}>{["Draft","Active","In Progress","Screening","Interview","Pending Approval","Completed","Approved","Closed"].map((x)=><option key={x}>{x}</option>)}</Select></Field><Field label={hiring ? "Interview / decision date" : "Due date"}><Input type="date" value={rf.dueDate} onChange={(e)=>setRf({...rf,dueDate:e.target.value})}/></Field>{!hiring && <Field label="Progress %"><Input type="number" min="0" max="100" value={rf.progress} onChange={(e)=>setRf({...rf,progress:e.target.value})}/></Field>}{!hiring && !entity?.credentials && <Field label="Amount / value"><Input type="number" value={rf.amount} onChange={(e)=>setRf({...rf,amount:e.target.value})}/></Field>}{ws.assignable_employees.length>0 && <Field label={hiring ? "Recruiter / owner" : "Assign employee"}><Select value={rf.employeeId} onChange={(e)=>setRf({...rf,employeeId:e.target.value})}><option value="">Unassigned</option>{ws.assignable_employees.map((e)=><option key={e.id} value={e.id}>L{e.access_level} · {e.name} · {e.role_name}</option>)}</Select></Field>}<div className="sm:col-span-2"><Field label={hiring ? "Screening / hiring notes" : "Details"}><Textarea rows={4} value={rf.description} onChange={(e)=>setRf({...rf,description:e.target.value})}/></Field></div></div></Modal>

    <Modal open={projectOpen} onClose={() => setProjectOpen(false)} title={editingProject ? "Update Project Progress" : "Assign Project"} footer={<><Btn variant="ghost" onClick={() => setProjectOpen(false)}>Cancel</Btn><Btn loading={busy} onClick={() => void saveProject()}>Save Project</Btn></>}><div className="grid gap-3 sm:grid-cols-2"><Field label="Project name" req><Input disabled={!!editingProject && !canManageProjects} value={pf.name} onChange={(e)=>setPf({...pf,name:e.target.value})}/></Field>{canManageProjects && <Field label="Assigned employee"><Select value={pf.employeeId} onChange={(e)=>setPf({...pf,employeeId:e.target.value})}><option value="">Select employee</option>{ws.assignable_employees.filter((e)=>e.access_level!==6).map((e)=><option key={e.id} value={e.id}>L{e.access_level} · {e.name} · {e.role_name}</option>)}</Select></Field>}<Field label="Status"><Select value={pf.status} onChange={(e)=>setPf({...pf,status:e.target.value})}>{["Planned","In Progress","Blocked","Review","Completed","On Hold"].map((x)=><option key={x}>{x}</option>)}</Select></Field><Field label="Progress %"><Input type="number" min="0" max="100" value={pf.progress} onChange={(e)=>setPf({...pf,progress:e.target.value})}/></Field>{canManageProjects && <><Field label="Start date"><Input type="date" value={pf.startDate} onChange={(e)=>setPf({...pf,startDate:e.target.value})}/></Field><Field label="Due date"><Input type="date" value={pf.dueDate} onChange={(e)=>setPf({...pf,dueDate:e.target.value})}/></Field><div className="sm:col-span-2"><Field label="Description"><Textarea value={pf.description} onChange={(e)=>setPf({...pf,description:e.target.value})}/></Field></div></>}<div className="sm:col-span-2"><Field label="Latest progress update"><Textarea value={pf.lastUpdate} onChange={(e)=>setPf({...pf,lastUpdate:e.target.value})}/></Field></div></div></Modal>
  </div>;
}
