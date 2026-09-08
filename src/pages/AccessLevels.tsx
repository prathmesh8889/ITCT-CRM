import { useEffect, useMemo, useState } from "react";
import { Search, ShieldAlert, Users } from "lucide-react";
import { api, DEMO_MODE } from "../lib/api";
import { useDB } from "../lib/db";
import { useStore } from "../store";
import { Badge } from "../components/ui";

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
  { level: 3, code: "L3", name: "Department Head / HOD", scope: "Department Ownership", data_visibility: "Only the assigned department and its subordinate work", summary: "Owns one department and its routine decisions.", member_count: 0 },
  { level: 4, code: "L4", name: "Team Lead", scope: "Team Workspace", data_visibility: "Only the assigned team and team execution", summary: "Owns execution for an assigned team.", member_count: 0 },
  { level: 5, code: "L5", name: "Full-Time Employee", scope: "Individual Workspace", data_visibility: "Own tasks, assigned CRM records and personal KPIs", summary: "Individual execution layer.", member_count: 0 },
  { level: 6, code: "L6", name: "Intern", scope: "Restricted / Sandbox", data_visibility: "Restricted tasks with masked PII and no bulk export", summary: "Supervised learning and support layer.", member_count: 0 },
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
  const { toast } = useStore();
  const d = useDB();
  const [levels, setLevels] = useState<LevelDef[]>(baseLevels);
  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");

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

  return (
    <div className="mx-auto max-w-[1240px] p-3 sm:p-4 md:p-6">
      <div className="mb-5">
        <div className="flex items-center gap-2">
          <ShieldAlert size={21} className="text-brand-600" />
          <h1 className="hd text-[22px]">6-Level Access Hierarchy</h1>
        </div>
        <p className="mt-1 max-w-3xl text-[12.5px] leading-relaxed text-ink-500">
          Workforce levels are now bound to the approved role catalog. Super Admin/Admin are global; all other levels are restricted to department, team or personal scope.
        </p>
      </div>

      <div className="mb-5 rounded-lg border border-brand-200 bg-brand-50/70 p-3 text-[12px] leading-relaxed text-brand-900 dark:border-brand-900/60 dark:bg-brand-950/25 dark:text-brand-200">
        <strong>Role-controlled hierarchy:</strong> L3–L6 is not edited separately anymore. Change an employee's approved role from <strong>Employees</strong>; the correct department and level are applied automatically. Counts and employees on this page are limited to the viewer's Workforce OS scope.
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

      <div className="mb-3 mt-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="hd flex items-center gap-2 text-[17px]"><Users size={17} /> Employee Level Assignment</h2>
          <p className="mt-1 text-[11.5px] text-ink-500">Read-only hierarchy status. Official Workforce role → department → level is fixed as one policy unit.</p>
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
                  <div><span className="text-ink-400">Department</span><div className="mt-0.5 truncate font-medium">{employee.department || "Global"}</div></div>
                  <div><span className="text-ink-400">Level scope</span><div className="mt-0.5 truncate font-medium">{def?.scope || "—"}</div></div>
                </div>
                <div className="mt-3 rounded-md border border-ink-100 bg-ink-50 px-2.5 py-2 text-[10.5px] text-ink-500 dark:border-ink-800 dark:bg-ink-800/50">
                  Level is fixed by the approved role. Use Employee Management to change role/department.
                </div>
              </div>
            );
          })}
          {filtered.length === 0 && <div className="card col-span-full p-8 text-center text-[13px] text-ink-500">No employees are visible in your current scope.</div>}
        </div>
      )}
    </div>
  );
}
