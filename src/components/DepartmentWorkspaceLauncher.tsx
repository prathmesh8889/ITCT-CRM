import { Building2 } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { useStore } from "../store";

export default function DepartmentWorkspaceLauncher() {
  const { user, roleName } = useStore();
  const navigate = useNavigate();
  const location = useLocation();
  if (!user || ["/department-workspace", "/login", "/change-password"].includes(location.pathname)) return null;
  const label = roleName === "Super Admin" || roleName === "Admin" ? "Department Workspaces" : "My Department";
  return <button type="button" onClick={() => navigate("/department-workspace")} title={label}
    className="fixed bottom-4 left-4 z-40 flex items-center gap-2 rounded-full border border-brand-200 bg-surface px-3.5 py-2 text-[11.5px] font-semibold text-brand-700 shadow-lg transition hover:-translate-y-0.5 hover:bg-brand-50 dark:border-brand-900 dark:bg-ink-900 dark:text-brand-300">
    <Building2 size={14}/>{label}
  </button>;
}
