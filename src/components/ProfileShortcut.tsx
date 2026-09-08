import { Building2, CalendarDays, ShieldAlert, UserRound } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { useStore } from "../store";

export default function ProfileShortcut() {
  const { user, can } = useStore();
  const nav = useNavigate();
  const loc = useLocation();
  if (!user || loc.pathname === "/change-password") return null;
  const cls = "flex items-center gap-2 rounded-full border border-ink-200 bg-surface px-2.5 py-2 text-[12px] font-semibold text-ink-700 shadow-lg transition hover:-translate-y-0.5 hover:border-brand-300 hover:text-brand-700 dark:border-ink-700 dark:bg-ink-900 dark:text-ink-200 sm:px-3";
  return (
    <div className="fixed bottom-3 right-3 z-40 flex flex-col items-end gap-2 sm:bottom-4 sm:right-4">
      {loc.pathname !== "/calendar" && (
        <button onClick={() => nav("/calendar")} className={cls} title="Open monthly calendar" aria-label="Open monthly calendar">
          <CalendarDays size={16} /><span className="hidden sm:inline">Calendar</span>
        </button>
      )}
      {can("employees", "view") && loc.pathname !== "/access-levels" && (
        <button onClick={() => nav("/access-levels")} className={cls} title="Open 6-level access hierarchy" aria-label="Open access levels">
          <ShieldAlert size={16} /><span className="hidden sm:inline">Access Levels</span>
        </button>
      )}
      {can("employees", "view") && loc.pathname !== "/departments" && (
        <button onClick={() => nav("/departments")} className={cls} title="Open departments" aria-label="Open departments">
          <Building2 size={16} /><span className="hidden sm:inline">Departments</span>
        </button>
      )}
      {!loc.pathname.startsWith("/profile/") && (
        <button onClick={() => nav(`/profile/${user.id}`)} className={cls} title="Open my profile" aria-label="Open my profile">
          <UserRound size={16} /><span className="hidden sm:inline">My profile</span>
        </button>
      )}
    </div>
  );
}
