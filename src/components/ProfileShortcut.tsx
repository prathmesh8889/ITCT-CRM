import { Building2, CalendarDays, UserRound } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { useStore } from "../store";

export default function ProfileShortcut() {
  const { user, can } = useStore();
  const nav = useNavigate();
  const loc = useLocation();
  if (!user || loc.pathname === "/change-password") return null;
  return (
    <div className="fixed bottom-4 right-4 z-40 flex flex-col items-end gap-2">
      {loc.pathname !== "/calendar" && (
        <button onClick={() => nav("/calendar")} className="flex items-center gap-2 rounded-full border border-ink-200 bg-surface px-3 py-2 text-[12px] font-semibold text-ink-700 shadow-lg transition hover:-translate-y-0.5 hover:border-brand-300 hover:text-brand-700 dark:border-ink-700 dark:bg-ink-900 dark:text-ink-200" title="Open monthly calendar">
          <CalendarDays size={16} /><span>Calendar</span>
        </button>
      )}
      {can("employees", "view") && loc.pathname !== "/departments" && (
        <button onClick={() => nav("/departments")} className="flex items-center gap-2 rounded-full border border-ink-200 bg-surface px-3 py-2 text-[12px] font-semibold text-ink-700 shadow-lg transition hover:-translate-y-0.5 hover:border-brand-300 hover:text-brand-700 dark:border-ink-700 dark:bg-ink-900 dark:text-ink-200" title="Open departments">
          <Building2 size={16} /><span>Departments</span>
        </button>
      )}
      {!loc.pathname.startsWith("/profile/") && (
        <button onClick={() => nav(`/profile/${user.id}`)} className="flex items-center gap-2 rounded-full border border-ink-200 bg-surface px-3 py-2 text-[12px] font-semibold text-ink-700 shadow-lg transition hover:-translate-y-0.5 hover:border-brand-300 hover:text-brand-700 dark:border-ink-700 dark:bg-ink-900 dark:text-ink-200" title="Open my profile">
          <UserRound size={16} /><span>My profile</span>
        </button>
      )}
    </div>
  );
}
