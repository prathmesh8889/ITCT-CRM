import { useEffect, useMemo, useState } from "react";
import { Crown, Pencil, Plus, Search, Users } from "lucide-react";
import { api, DEMO_MODE } from "../lib/api";
import { useStore } from "../store";
import { Avatar, Badge, Btn, Field, Input, Modal, Select } from "../components/ui";

type TeamMember = {
  id: number;
  name: string;
  email?: string;
  department?: string;
  designation?: string;
  access_level?: number;
  active?: boolean;
  team_id?: number | null;
  color?: string;
};

type Team = {
  id: number;
  name: string;
  focus?: string;
  department: string;
  lead_user_id?: number | null;
  active?: boolean;
  member_ids: number[];
  member_count?: number;
  lead?: { id: number; name: string; email?: string; designation?: string; access_level?: number } | null;
  members?: TeamMember[];
};

type Department = { id: number; name: string; system?: boolean; active?: boolean };

type TeamForm = {
  name: string;
  department: string;
  focus: string;
  leadUserId: string;
  memberIds: number[];
};

function TeamEditor({
  team,
  departments,
  employees,
  onClose,
  onSaved,
}: {
  team: Team | null;
  departments: Department[];
  employees: TeamMember[];
  onClose: () => void;
  onSaved: (team: Team) => void;
}) {
  const { toast } = useStore();
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<TeamForm>(() => ({
    name: team?.name || "",
    department: team?.department || (departments.length === 1 ? departments[0].name : ""),
    focus: team?.focus || "",
    leadUserId: team?.lead_user_id ? String(team.lead_user_id) : "",
    memberIds: team?.member_ids || [],
  }));

  const departmentEmployees = useMemo(
    () => employees.filter((x) => x.active !== false && x.department === form.department),
    [employees, form.department],
  );
  const leadCandidates = departmentEmployees.filter((x) => Number(x.access_level) === 4);
  const memberCandidates = departmentEmployees.filter((x) => {
    const level = Number(x.access_level);
    const belongsHere = !x.team_id || Number(x.team_id) === Number(team?.id);
    return belongsHere && level >= 4 && level <= 6;
  });

  const changeDepartment = (department: string) => {
    setForm((p) => ({ ...p, department, leadUserId: "", memberIds: [] }));
  };
  const toggleMember = (id: number) => setForm((p) => ({
    ...p,
    memberIds: p.memberIds.includes(id) ? p.memberIds.filter((x) => x !== id) : [...p.memberIds, id],
  }));

  const save = async () => {
    if (!form.name.trim()) { toast("Team name is required", "err"); return; }
    if (!form.department) { toast("Department is required", "err"); return; }
    const members = [...form.memberIds];
    const leadId = form.leadUserId ? Number(form.leadUserId) : null;
    if (leadId && !members.includes(leadId)) members.push(leadId);
    setBusy(true);
    try {
      if (DEMO_MODE) { toast("Team management requires the production backend", "warn"); return; }
      const body = {
        name: form.name.trim(),
        department: form.department,
        focus: form.focus.trim(),
        lead_user_id: leadId,
        member_ids: members,
      };
      const r = team
        ? await api.patch<Team>(`/teams/${team.id}`, body)
        : await api.post<Team>("/teams", body);
      onSaved(r.data);
      toast(team ? "Team updated" : "Team created", "ok", `${r.data.name} · ${r.data.department}`);
      onClose();
    } catch (e) { toast(e instanceof Error ? e.message : "Could not save team", "err"); }
    finally { setBusy(false); }
  };

  return <Modal open onClose={onClose} title={team ? "Edit team" : "Create team"} footer={
    <><Btn variant="ghost" onClick={onClose}>Cancel</Btn><Btn loading={busy} onClick={() => void save()}>{team ? "Save changes" : "Create team"}</Btn></>
  }>
    <div className="mb-4 rounded-lg border border-brand-100 bg-brand-50/60 p-3 text-[11.5px] text-brand-800 dark:border-brand-900 dark:bg-brand-950/20 dark:text-brand-200">
      Teams are department-scoped. A Department Head can manage only their own department; Super Admin/Admin can choose any approved department.
    </div>
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <Field label="Team name" req><Input value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} placeholder="e.g. Backend Team" /></Field>
      <Field label="Department" req>
        <Select value={form.department} onChange={(e) => changeDepartment(e.target.value)} disabled={departments.length === 1}>
          <option value="">Select department</option>
          {departments.filter((d) => d.system && d.active !== false).map((d) => <option key={d.id} value={d.name}>{d.name}</option>)}
        </Select>
      </Field>
      <Field label="Team Lead">
        <Select value={form.leadUserId} onChange={(e) => setForm((p) => ({ ...p, leadUserId: e.target.value }))} disabled={!form.department}>
          <option value="">No Team Lead yet</option>
          {leadCandidates.map((u) => <option key={u.id} value={u.id}>{u.name} · {u.designation || "L4"}</option>)}
        </Select>
      </Field>
      <Field label="Focus / Project"><Input value={form.focus} onChange={(e) => setForm((p) => ({ ...p, focus: e.target.value }))} placeholder="Main responsibility or project" /></Field>
      <div className="sm:col-span-2">
        <Field label="Members">
          <div className="max-h-64 overflow-y-auto rounded-lg border border-ink-200 p-2 dark:border-ink-700">
            {!form.department ? <div className="p-4 text-center text-[12px] text-ink-400">Select a department first.</div>
              : memberCandidates.length === 0 ? <div className="p-4 text-center text-[12px] text-ink-400">No available L4–L6 employees in this department.</div>
              : memberCandidates.map((u) => {
                const checked = form.memberIds.includes(u.id) || Number(form.leadUserId) === u.id;
                return <label key={u.id} className="flex cursor-pointer items-center gap-3 rounded-md px-2.5 py-2 hover:bg-ink-50 dark:hover:bg-ink-800/60">
                  <input type="checkbox" checked={checked} disabled={Number(form.leadUserId) === u.id} onChange={() => toggleMember(u.id)} />
                  <Avatar name={u.name} color={u.color || "#0F766E"} size={28} />
                  <span className="min-w-0 flex-1"><span className="block truncate text-[12.5px] font-semibold">{u.name}</span><span className="block truncate text-[10.5px] text-ink-400">L{u.access_level} · {u.designation || "Employee"}</span></span>
                  {Number(form.leadUserId) === u.id && <Badge tone="amber">Lead</Badge>}
                </label>;
              })}
          </div>
        </Field>
      </div>
    </div>
  </Modal>;
}

export default function TeamsPage() {
  const { can, toast } = useStore();
  const [teams, setTeams] = useState<Team[]>([]);
  const [employees, setEmployees] = useState<TeamMember[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Team | null>(null);

  const load = async () => {
    if (DEMO_MODE) { setLoading(false); return; }
    setLoading(true);
    try {
      const [t, u, d] = await Promise.all([
        api.get<Team[]>("/teams"),
        api.get<TeamMember[]>("/users"),
        api.get<Department[]>("/departments"),
      ]);
      setTeams(t.data || []); setEmployees(u.data || []); setDepartments(d.data || []);
    } catch (e) { toast(e instanceof Error ? e.message : "Could not load teams", "err"); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return teams;
    return teams.filter((t) => `${t.name} ${t.department} ${t.focus || ""} ${t.lead?.name || ""}`.toLowerCase().includes(needle));
  }, [teams, q]);

  const saved = (row: Team) => setTeams((xs) => xs.some((x) => x.id === row.id)
    ? xs.map((x) => x.id === row.id ? row : x)
    : [...xs, row].sort((a, b) => `${a.department}-${a.name}`.localeCompare(`${b.department}-${b.name}`)));

  return <div className="mx-auto max-w-[1280px] p-3 sm:p-4 md:p-6">
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div><div className="mb-1 flex items-center gap-2"><Badge tone="green">Workforce OS</Badge><span className="text-[10px] font-bold uppercase tracking-[0.12em] text-ink-400">Department Teams</span></div>
        <h1 className="hd flex items-center gap-2 text-[22px]"><Users size={20} /> Teams</h1>
        <p className="mt-1 text-[12.5px] text-ink-500">Create department teams, assign the L4 Team Lead and add only members from the same department.</p></div>
      {can("teams", "create") && <Btn size="sm" className="w-full sm:w-auto" onClick={() => setAdding(true)}><Plus size={14} /> Create Team</Btn>}
    </div>

    <div className="mb-4 rounded-lg border border-ink-200/80 bg-surface p-3 dark:border-ink-700 dark:bg-ink-900">
      <div className="relative w-full sm:max-w-md"><Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" /><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search team, department, lead or focus..." className="pl-9" /></div>
    </div>

    {loading ? <div className="card p-10 text-center text-[13px] text-ink-400">Loading teams…</div>
      : filtered.length === 0 ? <div className="card p-10 text-center"><Users size={28} className="mx-auto text-ink-300" /><div className="mt-2 text-[13px] font-semibold">No teams yet</div><div className="mt-1 text-[11.5px] text-ink-400">Create the first team for your department.</div></div>
      : <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">{filtered.map((team) => <div key={team.id} className="card p-4">
        <div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="hd truncate text-[15px]">{team.name}</div><div className="mt-1 text-[11px] text-ink-400">{team.department}</div></div><Badge tone="teal">{team.member_count ?? team.member_ids.length} members</Badge></div>
        <div className="mt-3 rounded-lg border border-ink-100 bg-ink-50/60 p-3 dark:border-ink-800 dark:bg-ink-800/40">
          <div className="flex items-center gap-2 text-[11.5px]"><Crown size={13} className="text-amber-500" /><span className="text-ink-400">Team Lead</span><strong className="ml-auto truncate">{team.lead?.name || "Not assigned"}</strong></div>
          <div className="mt-2 text-[11.5px]"><span className="text-ink-400">Focus</span><div className="mt-0.5 line-clamp-2 font-medium">{team.focus || "No focus/project added"}</div></div>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">{(team.members || []).slice(0, 6).map((m) => <span key={m.id} className="flex items-center gap-1.5 rounded-full border border-ink-200 py-0.5 pl-0.5 pr-2 text-[10.5px] dark:border-ink-700"><Avatar name={m.name} color={m.color || "#0F766E"} size={18} />{m.name.split(" ")[0]}</span>)}{(team.member_count || 0) > 6 && <Badge tone="slate">+{(team.member_count || 0) - 6}</Badge>}</div>
        {can("teams", "edit") && <div className="mt-4 border-t border-ink-100 pt-3 text-right dark:border-ink-800"><Btn size="xs" variant="outline" onClick={() => setEditing(team)}><Pencil size={12} /> Edit Team</Btn></div>}
      </div>)}</div>}

    {adding && <TeamEditor team={null} departments={departments} employees={employees} onClose={() => setAdding(false)} onSaved={saved} />}
    {editing && <TeamEditor team={editing} departments={departments} employees={employees} onClose={() => setEditing(null)} onSaved={saved} />}
  </div>;
}
