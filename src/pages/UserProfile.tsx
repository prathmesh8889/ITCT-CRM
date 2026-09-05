import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Briefcase, CalendarDays, KeyRound, ListChecks, Mail, Phone, Target, UserRound, Users } from "lucide-react";
import { api } from "../lib/api";
import { useStore } from "../store";
import { Avatar, Badge, Btn } from "../components/ui";
import { fmtDT } from "../lib/services";

type ProfileResponse = {
  user: {
    id: number; name: string; email: string; phone?: string; department?: string; designation?: string;
    role_id?: number | null; team_id?: number | null; active?: boolean; color?: string;
    joining_date?: string | null; created_at?: string; last_login_at?: string | null;
    must_change_password?: boolean;
  };
  role: { id: number; name: string } | null;
  team: { id: number; name: string } | null;
  summary: { leads: number; tasks: number; deals: number; followups: number };
};

export default function UserProfile() {
  const { id } = useParams();
  const { user, toast } = useStore();
  const nav = useNavigate();
  const targetId = id === "me" || !id ? user?.id : id;
  const [data, setData] = useState<ProfileResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!targetId) return;
    let live = true;
    setLoading(true);
    api.get<ProfileResponse>(`/users/${targetId}/profile`)
      .then((r) => { if (live) setData(r.data); })
      .catch((e) => { if (live) toast(e instanceof Error ? e.message : "Could not load profile", "err"); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [targetId, toast]);

  if (loading) return <div className="p-6 text-[13px] text-ink-500">Loading profile…</div>;
  if (!data) return <div className="p-6"><div className="card p-8 text-center text-[13px] text-ink-500">Profile could not be loaded.</div></div>;

  const p = data.user;
  const own = String(p.id) === user?.id;
  return (
    <div className="mx-auto max-w-[1050px] p-4 md:p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <Btn variant="ghost" size="sm" onClick={() => nav(-1)}><ArrowLeft size={14} /> Back</Btn>
        {own && <Btn variant="outline" size="sm" onClick={() => nav("/change-password")}><KeyRound size={14} /> Change my password</Btn>}
      </div>

      <div className="card overflow-hidden">
        <div className="bg-gradient-to-r from-brand-700 to-brand-500 px-5 py-7 text-white sm:px-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            <Avatar name={p.name} color={p.color || "#0F766E"} size={64} />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="hd text-[24px] text-white">{p.name}</h1>
                <Badge tone={p.active === false ? "red" : "green"}>{p.active === false ? "Disabled" : "Active"}</Badge>
                {p.must_change_password && <Badge tone="amber">Password change required</Badge>}
              </div>
              <p className="mt-1 text-[13px] text-white/75">{p.designation || data.role?.name || "Employee"}{p.department ? ` · ${p.department}` : ""}</p>
            </div>
          </div>
        </div>

        <div className="grid gap-5 p-5 sm:p-7 lg:grid-cols-[1.2fr_.8fr]">
          <div>
            <h2 className="hd mb-3 flex items-center gap-2 text-[15px]"><UserRound size={16} /> Profile details</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <Info icon={<Mail size={15} />} label="Email" value={p.email} />
              <Info icon={<Phone size={15} />} label="Phone" value={p.phone || "—"} />
              <Info icon={<Briefcase size={15} />} label="Role" value={data.role?.name || "—"} />
              <Info icon={<Users size={15} />} label="Team" value={data.team?.name || "No team"} />
              <Info icon={<CalendarDays size={15} />} label="Joining date" value={p.joining_date ? String(p.joining_date).slice(0, 10) : "—"} />
              <Info icon={<CalendarDays size={15} />} label="Last login" value={p.last_login_at ? fmtDT(p.last_login_at) : "Never"} />
            </div>
          </div>

          <div>
            <h2 className="hd mb-3 text-[15px]">CRM activity</h2>
            <div className="grid grid-cols-2 gap-3">
              <Metric icon={<Target size={16} />} label="Assigned leads" value={data.summary.leads} />
              <Metric icon={<ListChecks size={16} />} label="Tasks" value={data.summary.tasks} />
              <Metric icon={<Briefcase size={16} />} label="Deals" value={data.summary.deals} />
              <Metric icon={<Phone size={16} />} label="Follow-ups" value={data.summary.followups} />
            </div>
            <div className="mt-3 rounded-lg border border-ink-200/70 bg-ink-50 p-3 text-[11.5px] text-ink-500 dark:border-ink-700 dark:bg-ink-800/50">
              CRM account created: {p.created_at ? fmtDT(p.created_at) : "—"}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Info({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return <div className="rounded-lg border border-ink-200/70 p-3 dark:border-ink-700"><div className="flex items-center gap-2 text-[11px] text-ink-400">{icon}{label}</div><div className="mt-1 break-words text-[13px] font-semibold text-ink-800 dark:text-ink-100">{value}</div></div>;
}

function Metric({ icon, label, value }: { icon: ReactNode; label: string; value: number }) {
  return <div className="rounded-lg border border-ink-200/70 bg-surface p-3 dark:border-ink-700 dark:bg-ink-900"><div className="flex items-center gap-2 text-brand-600">{icon}<span className="num text-[18px] font-bold">{value}</span></div><div className="mt-1 text-[11px] text-ink-400">{label}</div></div>;
}
