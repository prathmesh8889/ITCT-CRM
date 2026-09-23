import { useState } from "react";
import { Radar, Plus, Play, Pause, Square, RotateCcw, ChevronDown, ChevronUp, MapPin, AlertTriangle, CheckCircle2, Info } from "lucide-react";
import { useStore } from "../store";
import { mutate, useDB } from "../lib/db";
import { fmtDT } from "../lib/services";
import { discoveryApi } from "../lib/api";
import type { DiscoveryJob } from "../lib/types";
import { Btn, Badge, Modal, Field, Input, Select, Textarea, EmptyState, Progress, statusTone, Reveal } from "../components/ui";

const fromApiJob = (j: any): DiscoveryJob => ({
  id: String(j.id), createdBy: String(j.created_by), category: j.category || "", location: j.location || "",
  target: Number(j.target) || 0, source: j.source || "maps", keywords: j.keywords || "",
  status: j.status || "Queued", discovered: Number(j.discovered) || 0, valid: Number(j.valid) || 0,
  duplicates: Number(j.duplicates) || 0, invalid: Number(j.invalid) || 0,
  failedRecords: Number(j.failed_records) || 0, startedAt: j.started_at || null,
  completedAt: j.completed_at || null, error: j.error || "", attempts: 0,
  retryLog: Array.isArray(j.retry_log) ? j.retry_log : [],
});

const CATS = ["Digital Marketing Agency", "Software Company", "Manufacturing", "Interior Design", "Restaurant & Café", "Healthcare Clinic", "Fitness & Gym", "Education Institute", "Real Estate", "E-commerce Store", "CA & Accounting Firm", "Logistics & Transport"];

function JobCard({ job, delay }: { job: DiscoveryJob; delay: number }) {
  const { toast } = useStore();
  const d = useDB();
  const [showLog, setShowLog] = useState(false);
  const pct = Math.round((job.discovered / Math.max(1, job.target)) * 100);
  const creator = d.users.find((u) => u.id === job.createdBy);
  const active = job.status === "Running";
  return (
    <Reveal delay={delay}>
      <div className={`card p-4 transition-shadow hover:shadow-md ${active ? "border-brand-300/70 dark:border-brand-700" : ""}`}>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="hd truncate text-[14.5px]">{job.category}</h3>
              <Badge tone={statusTone(job.status)}>{job.status}{active && <span className="ml-0.5 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-blue-500" />}</Badge>
            </div>
            <div className="mt-0.5 flex items-center gap-1.5 text-[11.5px] text-ink-400">
              <MapPin size={11} /> {job.location} · target {job.target} · by {creator?.name || "—"} · {job.source === "maps" ? "Google Maps (public listings)" : job.source === "directory" ? "public directory" : job.source === "website" ? "website crawl" : "CSV upload"}
              {job.keywords && <Badge tone="slate">{job.keywords}</Badge>}
            </div>
          </div>
          <div className="flex gap-1.5">
            {job.status === "Queued" && <Badge tone="blue"><Play size={10} /> Starting automatically</Badge>}
            {active && <Btn size="xs" variant="outline" onClick={() => void (async () => {
              try {
                const r = await discoveryApi.pause(Number(job.id)); const row = fromApiJob(r.data);
                mutate((db) => { const i = db.discoveryJobs.findIndex((x) => x.id === job.id); if (i >= 0) db.discoveryJobs[i] = row; });
                toast("Job paused", "warn", "Progress preserved — resume anytime.");
              } catch (e) { toast(e instanceof Error ? e.message : "Could not pause job", "err"); }
            })()}><Pause size={12} /> Pause</Btn>}
            {job.status === "Paused" && <Btn size="xs" onClick={() => void (async () => {
              try {
                const r = await discoveryApi.resume(Number(job.id)); const row = fromApiJob(r.data);
                mutate((db) => { const i = db.discoveryJobs.findIndex((x) => x.id === job.id); if (i >= 0) db.discoveryJobs[i] = row; });
                toast("Job resumed", "ok");
              } catch (e) { toast(e instanceof Error ? e.message : "Could not resume job", "err"); }
            })()}><Play size={12} /> Resume</Btn>}
            {["Running", "Paused", "Queued"].includes(job.status) && <Btn size="xs" variant="ghost" onClick={() => void (async () => {
              try {
                const r = await discoveryApi.cancel(Number(job.id)); const row = fromApiJob(r.data);
                mutate((db) => { const i = db.discoveryJobs.findIndex((x) => x.id === job.id); if (i >= 0) db.discoveryJobs[i] = row; });
                toast("Job cancelled", "warn");
              } catch (e) { toast(e instanceof Error ? e.message : "Could not cancel job", "err"); }
            })()}><Square size={12} /> Cancel</Btn>}
            {["Failed", "Cancelled", "Partially Completed", "Completed"].includes(job.status) && (
              <Btn size="xs" variant="outline" onClick={() => void (async () => {
                try {
                  const r = await discoveryApi.create({ category: job.category, location: job.location, target: job.target, source: job.source, keywords: job.keywords });
                  const row = fromApiJob(r.data); mutate((db) => db.discoveryJobs.unshift(row)); toast("Job re-queued", "ok");
                } catch (e) { toast(e instanceof Error ? e.message : "Could not re-run job", "err"); }
              })()}><RotateCcw size={12} /> Re-run</Btn>
            )}
          </div>
        </div>

        <div className="mt-3 flex items-center gap-3">
          <div className="flex-1"><Progress value={pct} tone={job.status === "Failed" ? "red" : pct < 100 ? "teal" : "teal"} /></div>
          <span className="num text-[12px] font-bold text-ink-600 dark:text-ink-300">{pct}%</span>
        </div>
        <div className="num mt-3 grid grid-cols-5 gap-2 text-center">
          {[["Target", job.target, ""], ["Discovered", job.discovered, "text-ink-800 dark:text-ink-100"], ["Valid", job.valid, "text-emerald-600"], ["Duplicates", job.duplicates, "text-amber-600"], ["Invalid", job.invalid, "text-red-500"]].map(([l, v, c]) => (
            <div key={String(l)} className="rounded-md bg-ink-50 py-1.5 dark:bg-ink-800/60">
              <div className="text-[9.5px] font-bold uppercase tracking-wider text-ink-400">{String(l)}</div>
              <div className={`text-[15px] font-semibold ${String(c)}`}>{String(v)}</div>
            </div>
          ))}
        </div>
        {job.error && (
          <div className="mt-2.5 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-2.5 py-2 text-[12px] text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
            <AlertTriangle size={13} className="mt-0.5 shrink-0" /> {job.error}
          </div>
        )}
        <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 text-[10.5px] text-ink-400">
          <span className="num">{job.startedAt ? `started ${fmtDT(job.startedAt)}` : "not started"}{job.completedAt ? ` · ended ${fmtDT(job.completedAt)}` : ""}</span>
          <div className="flex items-center gap-2">
            <span className="flex items-center gap-1"><Info size={11} /> valid leads are auto-imported, de-duplicated & auto-assigned</span>
            {job.retryLog.length > 0 && (
              <button className="flex items-center gap-1 font-semibold text-brand-600 hover:text-brand-700" onClick={() => setShowLog((s) => !s)}>
                retry log ({job.retryLog.length}) {showLog ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
              </button>
            )}
          </div>
        </div>
        {showLog && (
          <div className="num mt-2 space-y-1 rounded-md bg-ink-900 p-2.5 text-[11px] text-ink-100 dark:bg-ink-950">
            {job.retryLog.map((r, i) => <div key={i}>» {r}</div>)}
          </div>
        )}
      </div>
    </Reveal>
  );
}

export default function Discovery() {
  const { user, can, toast } = useStore();
  const d = useDB();
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState(CATS[0]);
  const [location, setLocation] = useState("Pune, Maharashtra");
  const [target, setTarget] = useState(100);
  const [source, setSource] = useState<DiscoveryJob["source"]>("maps");
  const [keywords, setKeywords] = useState("");
  const [busy, setBusy] = useState(false);
  const jobs = d.discoveryJobs;

  const launch = async () => {
    if (!location.trim()) { toast("Location is required", "err"); return; }
    setBusy(true);
    try {
      const r = await discoveryApi.create({ category, location: location.trim(), target, source, keywords });
      const row = fromApiJob(r.data);
      mutate((db) => db.discoveryJobs.unshift(row));
      setOpen(false);
      toast("Discovery job launched", "ok", `${category} · ${location} · target ${target}`);
    } catch (e) { toast(e instanceof Error ? e.message : "Could not launch discovery job", "err"); }
    finally { setBusy(false); }
  };

  return (
    <div className="mx-auto max-w-[1200px] p-4 md:p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="hd flex items-center gap-2 text-[22px]"><Radar size={20} className="text-brand-600" /> Lead Discovery</h1>
          <p className="text-[12.5px] text-ink-500">Sourcing jobs over <b>publicly available</b> business data. CAPTCHAs, logins and rate limits are always respected — where automation isn't allowed, use CSV import.</p>
        </div>
        {can("discovery", "create") && <Btn onClick={() => setOpen(true)}><Plus size={14} /> New discovery job</Btn>}
      </div>

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        {[["maps", "Google Maps provider", "Public business listings — name, phone, website, rating"],
        ["directory", "Directory provider", "Public business directories with paged results"],
        ["website", "Website provider", "Crawls a public site — fails safely if policy blocks it"]].map(([k, t, s]) => (
          <div key={k} className="card p-3.5">
            <div className="text-[12.5px] font-semibold text-ink-700 dark:text-ink-200">{t}</div>
            <div className="text-[11.5px] text-ink-400">{s}</div>
          </div>
        ))}
      </div>

      {jobs.length === 0 ? (
        <EmptyState icon={<Radar size={26} />} title="No discovery jobs yet" body="Start one: pick a business category, a city, and how many leads you want."
          action={can("discovery", "create") ? <Btn size="sm" onClick={() => setOpen(true)}><Plus size={14} /> Create job</Btn> : undefined} />
      ) : (
        <div className="space-y-3">
          {jobs.map((j, i) => <JobCard key={j.id} job={j} delay={i * 60} />)}
        </div>
      )}

      {open && (
        <Modal open onClose={() => setOpen(false)} title="New lead discovery job">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Business category" req className="col-span-2">
              <Select value={category} onChange={(e) => setCategory(e.target.value)}>{CATS.map((c) => <option key={c}>{c}</option>)}</Select>
            </Field>
            <Field label="Location" req><Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="City, State" /></Field>
            <Field label="Target lead count" req><Input type="number" min={1} max={500} value={target} onChange={(e) => setTarget(Number(e.target.value))} /></Field>
            <Field label="Source" className="col-span-2">
              <Select value={source} onChange={(e) => setSource(e.target.value as DiscoveryJob["source"])}>
                <option value="maps">Google Maps — public listings</option>
                <option value="directory">Public business directory</option>
                <option value="website">Website crawl (may be blocked by policy)</option>
              </Select>
            </Field>
            <Field label="Optional keywords" className="col-span-2"><Input value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder="e.g. boutique, 24x7, ISO certified" /></Field>
          </div>
          <div className="mt-3 flex items-start gap-2 rounded-md bg-brand-50 px-3 py-2 text-[11.5px] text-brand-700 dark:bg-brand-900/25 dark:text-brand-200">
            <CheckCircle2 size={13} className="mt-0.5 shrink-0" />
            Runs in the background and persists progress. Discovered leads pass duplicate checks and validation before entering the CRM; a job is only marked completed when the target is genuinely met.
          </div>
          <div className="mt-4 flex justify-end gap-2"><Btn variant="ghost" onClick={() => setOpen(false)}>Cancel</Btn><Btn loading={busy} onClick={() => void launch()}><Radar size={14} /> Launch job</Btn></div>
        </Modal>
      )}
      {/* keep Textarea referenced for future notes field */}
      <span className="hidden"><Textarea defaultValue="" /></span>
    </div>
  );
}
