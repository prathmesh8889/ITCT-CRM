import { useEffect, useMemo, useState } from "react";
import { Search, ShieldAlert, Users } from "lucide-react";
import { api, DEMO_MODE } from "../lib/api";
import { useDB } from "../lib/db";
import { useStore } from "../store";
import { Badge, Select } from "../components/ui";

type LevelNumber = 1 | 2 | 3 | 4 | 5 | 6;
type LevelDef = {
  level: LevelNumber;
  code: string;
  name: string;
  scope: string;
  data_visibility: string;
  summary: string;
  member_count: number;
};
type EmployeeRow = {
  id: number | string;
  name: string;
  email: string;
  phone?: string;
  department?: string;
  designation?: string;
  role_id: number | string;
  access_level?: number;
  active?: boolean;
};

const baseLevels: LevelDef[] = [
  { level: 1, code: "L1", name: "Super Admin / CEO", scope: "Global Control", data_visibility: "Full organization, strategic KPIs and financial visibility", summary: "Highest organizational authority and global control.", member_count: 0 },
  { level: 2, code: "L2", name: "Operational Admin / COO", scope: "Global Operations", data_visibility: "Cross-department operations, utilization, SLA and performance visibility", summary: "Runs company-wide operations below the CEO layer.", member_count: 0 },
  { level: 3, code: "L3", name: "Department Head / HOD", scope: "Department Ownership", data_visibility: "Department-level people, budgets, hiring and performance", summary: "Owns one department and its routine decisions.", member_count: 0 },
  { level: 4, code: "L4", name: "Team Lead", scope: "Team Workspace", data_visibility: "Assigned team, daily execution, sprint/task visibility", summary: "Owns execution for an assigned team.", member_count: 0 },
  { level: 5, code: "L5", name: "Full-Time Employee", scope: "Individual Workspace", data_visibility: "Own tasks, assigned CRM records and personal KPIs", summary: "Individual execution layer.", member_count: 0 },
  { level: 6, code: "L6", name: "Intern", scope: "Restricted / Sandbox", data_visibility: "Restricted learning workspace; masking/sandbox policies are applied in later security steps", summary: "Lowest-trust supervised learning and support layer.", member_count: 0 },
];

const tone = (level: number): "red" | "amber" | "violet" | "blue" | "green" | "slate" =>
  level === 1 ? "red" : level === 2 ? "amber" : level === 3 ? "violet" : level === 4 ? "blue" : level === 5 ? "green" : "slate";

function inferredLevel(roleName: string): LevelNumber {
  const name = roleName.trim().toLowerCase();
  if (name === "super admin" || name === "ceo") return 1;
  if (["admin", "operational admin", "coo", "operations head"].includes(name)) return 2;
  if (name.includes("intern")) return 6;
  if (name.includes("team lead") || name.includes("team leader")) return 4;
  if (name.includes("manager") || name.includes("department head") || name.includes("hod")) return 3;
  return 5;
}

export default function AccessLevels() {
  const { user, can, toast } = useStore();
  const d = useDB();
  const [levels, setLevels] = useState<LevelDef[]>(baseLevels);
  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const roleName = (roleId: number | string) => d.roles.find((r) => String(r.id) === String(roleId))?.name || "No role";
  const levelOf = (employee: EmployeeRow): LevelNumber => {
    const n = Number(employee.access_level);
    return Number.isInteger(n) && n >= 1 && n <= 6 ? n as LevelNumber : inferredLevel(roleName(employee.role_id));
  };

  const load = async () => {
    setLoading(true);
    try {
      if (DEMO_MODE) {
        const rows: EmployeeRow[] = d.users.map((u) => ({
          id: u.id, name: u.name, email: u.email, phone: u.phone, role_id: u.roleId,
          active: u.active, access_level: inferredLevel(roleName(u.roleId)),
        }));
        const counts = new Map<number, number>();
        rows.forEach((u) => counts.set(levelOf(u), (counts.get(levelOf(u)) || 0) + 1));
        setEmployees(rows);
        setLevels(baseLevels.map((x) => ({ ...x, member_count: counts.get(x.level) || 0 })));
        return;
      }
      const [catalog, users] = await Promise.all([
        api.get<{ levels: LevelDef[] }>("/access-levels"),
        api.get<EmployeeRow[]>("/users"),
      ]);
      setLevels(catalog.data.levels || baseLevels);
      setEmployees(users.data || []);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not load access levels", "err");
    } finally { setLoading(false); }
  };

  useEffect(() => { void load(); }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return employees;
    return employees.filter((u) => {
      const l = levelOf(u);
      return `${u.name} ${u.email} ${u.phone || ""} ${u.department || ""} ${u.designation || ""} ${roleName(u.role_id)} L${l}`.toLowerCase().includes(q);
    });
  }, [employees, query, d.roles]);

  const changeLevel = async (employee: EmployeeRow, next: LevelNumber) => {
    const current = levelOf(employee);
    if (current === next) return;
    if (String(employee.id) === String(user?.id)) {
      toast("You cannot change your own access level", "warn");
      return;
    }
    const target = levels.find((x) => x.level === next);
    if (!window.confirm(`Change ${employee.name} from L${current} to L${next} - ${target?.name || "Access Level"}?`)) return;
    if (DEMO_MODE) { toast("Access-level changes require the backend workspace", "warn"); return; }

    setBusyId(String(employee.id));
    try {
      const r = await api.patch<EmployeeRow>(`/users/${employee.id}/access-level`, { access_level: next });
      setEmployees((xs) => xs.map((x) => String(x.id) === String(employee.id) ? { ...x, ...r.data, access_level: next } : x));
      setLevels((xs) => xs.map((x) => ({
        ...x,
        member_count: x.level === current ? Math.max(0, x.member_count - 1) : x.level === next ? x.member_count + 1 : x.member_count,
      })));
      toast("Access level updated", "ok", `${employee.name} → L${next} ${target?.name || ""}`);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not change access level", "err");
    } finally { setBusyId(null); }
  };

  const canEdit = can("employees", "edit");

  return (
    <div className="mx-auto max-w-[1240px] p-3 sm:p-4 md:p-6">
      <div className="mb-5">
        <div className="flex items-center gap-2">
          <ShieldAlert size={21} className="text-brand-600" />
          <h1 className="hd text-[22px]">6-Level Access Hierarchy</h1>
        </div>
        <p className="mt-1 text-[12.5px] text-ink-500">Step 1 foundation for organizational access. Levels are separate from job roles so the next department and role-mapping steps can be added safely.</p>
      </div>

      <div className="mb-5 rounded-lg border border-amber-200 bg-amber-50 p-3 text-[12px] leading-relaxed text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/25 dark:text-amber-200">
        <strong>Deny-by-default foundation:</strong> only higher authorized levels can assign lower organizational levels. Existing CRM module permissions remain role-based for now; department/team row-level filtering and Intern PII masking/export restrictions will be wired in their dedicated later steps instead of being guessed here.
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {levels.map((level) => (
          <div key={level.level} className="card p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2"><Badge tone={tone(level.level)}>{level.code}</Badge><h2 className="hd text-[15px]">{level.name}</h2></div>
                <div className="mt-2 text-[12px] font-semibold text-ink-700 dark:text-ink-200">{level.scope}</div>
              </div>
              <div className="flex h-9 min-w-9 items-center justify-center rounded-lg bg-ink-50 px-2 text-[11px] font-bold text-ink-600 dark:bg-ink-800 dark:text-ink-300">{level.member_count}</div>
            </div>
            <p className="mt-2 text-[11.5px] leading-relaxed text-ink-500">{level.summary}</p>
            <div className="mt-3 rounded-md bg-ink-50 p-2.5 text-[10.5px] leading-relaxed text-ink-500 dark:bg-ink-800/60">{level.data_visibility}</div>
          </div>
        ))}
      </div>

      <div className="mt-6 mb-3 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="hd flex items-center gap-2 text-[17px]"><Users size={17} /> Employee Level Assignment</h2>
          <p className="mt-1 text-[11.5px] text-ink-500">Current employee hierarchy. Assignment is validated again by the backend even if the browser is modified.</p>
        </div>
        <div className="relative w-full sm:max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
          <input className="inp pl-9" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name, role, department, level..." />
        </div>
      </div>

      {loading ? <div className="card p-8 text-center text-[13px] text-ink-500">Loading access hierarchy…</div> : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((employee) => {
            const current = levelOf(employee);
            const def = levels.find((x) => x.level === current);
            const self = String(employee.id) === String(user?.id);
            return (
              <div key={employee.id} className="card p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-[13.5px] font-semibold text-ink-900 dark:text-ink-50">{employee.name}</div>
                    <div className="mt-0.5 truncate text-[10.5px] text-ink-400">{employee.email}</div>
                  </div>
                  <Badge tone={tone(current)}>L{current}</Badge>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
                  <div><span className="text-ink-400">Role</span><div className="mt-0.5 truncate font-medium">{roleName(employee.role_id)}</div></div>
                  <div><span className="text-ink-400">Status</span><div className="mt-0.5 font-medium">{employee.active === false ? "Disabled" : "Active"}</div></div>
                  <div><span className="text-ink-400">Department</span><div className="mt-0.5 truncate font-medium">{employee.department || "—"}</div></div>
                  <div><span className="text-ink-400">Level scope</span><div className="mt-0.5 truncate font-medium">{def?.scope || "—"}</div></div>
                </div>
                <div className="mt-3 border-t border-ink-100 pt-3 dark:border-ink-800">
                  <label className="lbl">Access level</label>
                  <Select
                    value={String(current)}
                    disabled={!canEdit || self || busyId === String(employee.id)}
                    onChange={(e) => void changeLevel(employee, Number(e.target.value) as LevelNumber)}
                  >
                    {levels.map((level) => <option key={level.level} value={level.level}>{level.code} — {level.name}</option>)}
                  </Select>
                  {self && <div className="mt-1 text-[10px] text-ink-400">Your own level is protected from self-change.</div>}
                  {!canEdit && <div className="mt-1 text-[10px] text-ink-400">View only — employee edit permission is required.</div>}
                </div>
              </div>
            );
          })}
          {filtered.length === 0 && <div className="card col-span-full p-8 text-center text-[13px] text-ink-500">No employees match this search.</div>}
        </div>
      )}
    </div>
  );
}
