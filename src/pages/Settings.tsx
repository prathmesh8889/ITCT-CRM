import { useState } from "react";
import { Save, Plug, RefreshCw, Database, Trash2, MessageCircle, Mail } from "lucide-react";
import { useStore } from "../store";
import { mutate, useDB, uid, resetDB, storageKB } from "../lib/db";
import { ollamaPing, logAudit, downloadFile, todayISO } from "../lib/services";
import { DEMO_MODE, settingsApi } from "../lib/api";
import type { Template } from "../lib/types";
import { Btn, Badge, Field, Input, Select, Textarea, Tabs, Toggle, Money } from "../components/ui";

export default function Settings() {
  const { user, can, toast } = useStore();
  const d = useDB();
  const [tab, setTab] = useState("company");
  const editable = can("settings", "edit") || can("settings", "create");

  // company form
  const [co, setCo] = useState({ ...d.settings.company });
  const [aiS, setAiS] = useState({ ...d.settings.ai });
  const [sc, setSc] = useState({ ...d.settings.scoring });
  const [asg, setAsg] = useState({ ...d.settings.assignment });
  const [pingRes, setPingRes] = useState<{ ok: boolean; models: string[]; error?: string } | null>(null);
  const [tplEdit, setTplEdit] = useState<Template | null>(null);
  const [tplBody, setTplBody] = useState({ name: "", subject: "", body: "" });
  const [newStatus, setNewStatus] = useState("");
  const [newSource, setNewSource] = useState("");
  const [newStage, setNewStage] = useState("");

  const persist = async (key: "company" | "ai" | "scoring" | "assignment", value: unknown) => {
    if (!DEMO_MODE) await settingsApi.update({ [key]: value }); // PostgreSQL in production mode
  };
  const saveCo = async () => { try { await persist("company", co); } catch (e) { toast(e instanceof Error ? e.message : "Server save failed", "err"); return; } mutate((db) => { db.settings.company = { ...co }; }); toast("Company settings saved", "ok", "Branding updates across quotations and invoices."); };
  const saveAi = async () => { try { await persist("ai", aiS); } catch (e) { toast(e instanceof Error ? e.message : "Server save failed", "err"); return; } mutate((db) => { db.settings.ai = { ...aiS }; }); toast("AI settings saved"); };
  const saveSc = async () => { const sc2 = { ...sc, targetLocations: sc.targetLocations.map((x) => x.trim()).filter(Boolean), targetIndustries: sc.targetIndustries.map((x) => x.trim()).filter(Boolean) }; try { await persist("scoring", { ...sc2, target_locations: sc2.targetLocations, target_industries: sc2.targetIndustries }); } catch (e) { toast(e instanceof Error ? e.message : "Server save failed", "err"); return; } mutate((db) => { db.settings.scoring = sc2; }); toast("Scoring rules saved", "ok", "New leads will use these weights."); };
  const saveAsg = async () => { try { await persist("assignment", { strategy: asg.strategy, rr_pointer: asg.rrPointer, high_value_threshold: asg.highValueThreshold, high_value_user_id: asg.highValueUserId ? Number(asg.highValueUserId) : null, category_map: Object.fromEntries(Object.entries(asg.categoryMap).map(([k, v]) => [k, Number(v)])), location_map: Object.fromEntries(Object.entries(asg.locationMap).map(([k, v]) => [k, Number(v)])) }); } catch (e) { toast(e instanceof Error ? e.message : "Server save failed", "err"); return; } mutate((db) => { db.settings.assignment = { ...asg }; }); toast("Assignment strategy saved"); };
  const testAi = async () => { setPingRes(null); const r = await ollamaPing(aiS.url, 4000); setPingRes(r); toast(r.ok ? "Ollama connected" : "Ollama unreachable", r.ok ? "ok" : "warn", r.ok ? `${r.models.length} model(s) found` : r.error); };

  return (
    <div className="mx-auto max-w-[1100px] p-4 md:p-6">
      <div className="mb-4"><h1 className="hd text-[22px]">Settings</h1><p className="text-[12.5px] text-ink-500">Company branding, AI, scoring, assignment, templates and CRM lists — all persisted.</p></div>
      <Tabs className="mb-4" tabs={[{ key: "company", label: "Company" }, { key: "ai", label: "AI (Ollama)" }, { key: "templates", label: "Templates" }, { key: "scoring", label: "Lead Scoring" }, { key: "assignment", label: "Assignment" }, { key: "lists", label: "Statuses & Stages" }, { key: "data", label: "Data" }]} active={tab} onChange={setTab} />

      {tab === "company" && (
        <div className="card max-w-2xl p-5">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Company name" req><Input value={co.name} onChange={(e) => setCo((p) => ({ ...p, name: e.target.value }))} disabled={!editable} /></Field>
            <Field label="Tagline"><Input value={co.tagline} onChange={(e) => setCo((p) => ({ ...p, tagline: e.target.value }))} disabled={!editable} /></Field>
            <Field label="Email"><Input value={co.email} onChange={(e) => setCo((p) => ({ ...p, email: e.target.value }))} disabled={!editable} /></Field>
            <Field label="Phone"><Input value={co.phone} onChange={(e) => setCo((p) => ({ ...p, phone: e.target.value }))} disabled={!editable} /></Field>
            <Field label="Website"><Input value={co.website} onChange={(e) => setCo((p) => ({ ...p, website: e.target.value }))} disabled={!editable} /></Field>
            <Field label="Logo letter"><Input maxLength={1} value={co.logoMark} onChange={(e) => setCo((p) => ({ ...p, logoMark: e.target.value.toUpperCase() }))} disabled={!editable} /></Field>
            <Field label="Address" className="col-span-2"><Textarea value={co.address} onChange={(e) => setCo((p) => ({ ...p, address: e.target.value }))} disabled={!editable} /></Field>
            <Field label="GSTIN"><Input value={co.gstin} onChange={(e) => setCo((p) => ({ ...p, gstin: e.target.value }))} disabled={!editable} /></Field>
            <Field label="PAN"><Input value={co.pan} onChange={(e) => setCo((p) => ({ ...p, pan: e.target.value }))} disabled={!editable} /></Field>
            <Field label="Currency"><Select value={co.currency} onChange={(e) => setCo((p) => ({ ...p, currency: e.target.value }))} disabled={!editable}><option>INR</option></Select></Field>
            <Field label="Timezone"><Input value={co.timezone} onChange={(e) => setCo((p) => ({ ...p, timezone: e.target.value }))} disabled={!editable} /></Field>
          </div>
          {editable && <div className="mt-4 flex justify-end"><Btn onClick={saveCo}><Save size={14} /> Save company settings</Btn></div>}
        </div>
      )}

      {tab === "ai" && (
        <div className="card max-w-2xl p-5">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Ollama URL" className="col-span-2"><Input value={aiS.url} onChange={(e) => setAiS((p) => ({ ...p, url: e.target.value }))} placeholder="http://localhost:11434" disabled={!editable} /></Field>
            <Field label="Model"><Input value={aiS.model} onChange={(e) => setAiS((p) => ({ ...p, model: e.target.value }))} placeholder="qwen3 / llama3 / mistral / gemma" disabled={!editable} /></Field>
            <Field label={`Temperature · ${aiS.temperature}`}><input type="range" min={0} max={1} step={0.1} value={aiS.temperature} onChange={(e) => setAiS((p) => ({ ...p, temperature: Number(e.target.value) }))} className="w-full accent-brand-600" disabled={!editable} /></Field>
            <Field label="Timeout (seconds)"><Input type="number" value={aiS.timeoutSec} onChange={(e) => setAiS((p) => ({ ...p, timeoutSec: Number(e.target.value) }))} disabled={!editable} /></Field>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Btn variant="outline" onClick={testAi}><RefreshCw size={13} /> Test connection</Btn>
            {editable && <Btn onClick={saveAi}><Save size={14} /> Save AI settings</Btn>}
            {pingRes && (pingRes.ok ? (
              <span className="flex flex-wrap items-center gap-1.5 text-[12.5px] text-emerald-600"><Plug size={13} /> Connected —
                {(pingRes.models.length ? pingRes.models : [aiS.model]).map((m) => <Badge key={m} tone={m.startsWith(aiS.model) ? "teal" : "slate"}>{m}</Badge>)}
              </span>
            ) : <span className="text-[12.5px] text-amber-600">AI temporarily unavailable — {pingRes.error}. The CRM continues with the rules engine.</span>)}
          </div>
          <p className="mt-3 rounded-md bg-ink-50 p-3 text-[11.5px] leading-relaxed text-ink-500 dark:bg-ink-800/60">
            Setup: install Ollama separately, then <span className="num">ollama pull qwen3</span> · <span className="num">ollama serve</span>. Preferred models: Qwen, Llama, Mistral, Gemma. No paid APIs are ever required — if Ollama is offline, scoring and the assistant automatically fall back to the built-in deterministic engine.
          </p>
        </div>
      )}

      {tab === "templates" && (
        <div>
          <p className="mb-3 text-[12.5px] text-ink-500">Variables: {"{{customer_name}} {{employee_name}} {{company_name}} {{quotation_number}} {{invoice_number}} {{amount_due}}"}</p>
          <div className="grid gap-3 md:grid-cols-2">
            {(["whatsapp", "email"] as const).map((ch) => (
              <div key={ch} className="card p-4">
                <h3 className="hd mb-2 flex items-center gap-2 text-[14px]">{ch === "whatsapp" ? <MessageCircle size={14} className="text-emerald-600" /> : <Mail size={14} className="text-sky-600" />} WhatsApp-style — {ch === "whatsapp" ? "WhatsApp templates" : "Email templates"}</h3>
                {d.templates.filter((t) => t.channel === ch).map((t) => (
                  <div key={t.id} className="mb-2 flex items-center justify-between rounded-md border border-ink-100 p-2.5 dark:border-ink-800">
                    <div><div className="text-[12.5px] font-semibold">{t.name}</div><div className="max-w-[300px] truncate text-[11px] text-ink-400">{t.subject ? t.subject + " — " : ""}{t.body.split("\n")[0]}</div></div>
                    {editable && <Btn variant="ghost" size="xs" onClick={() => { setTplEdit(t); setTplBody({ name: t.name, subject: t.subject, body: t.body }); }}>Edit</Btn>}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === "scoring" && (
        <div className="card max-w-2xl p-5">
          <p className="mb-3 text-[12.5px] text-ink-500">Deterministic weights added on top of the base score (max 100). Applied to every new and re-scored lead.</p>
          <div className="grid grid-cols-3 gap-3">
            {([["phone", "Phone available"], ["email", "Email available"], ["website", "Website available"], ["location", "Target location"], ["industry", "Target industry"], ["rating", "High rating (≥4.2★)"], ["engagement", "Recent engagement"]] as const).map(([k, l]) => (
              <Field key={k} label={`${l} (+)`}><Input type="number" value={sc[k]} onChange={(e) => setSc((p) => ({ ...p, [k]: Number(e.target.value) }))} disabled={!editable} /></Field>
            ))}
          </div>
          <Field label="Target locations (comma separated)" className="mt-3"><Input value={sc.targetLocations.join(", ")} onChange={(e) => setSc((p) => ({ ...p, targetLocations: e.target.value.split(",") }))} disabled={!editable} /></Field>
          <Field label="Target industries (comma separated)" className="mt-3"><Input value={sc.targetIndustries.join(", ")} onChange={(e) => setSc((p) => ({ ...p, targetIndustries: e.target.value.split(",") }))} disabled={!editable} /></Field>
          {editable && <div className="mt-4 flex justify-end"><Btn onClick={saveSc}><Save size={14} /> Save scoring rules</Btn></div>}
        </div>
      )}

      {tab === "assignment" && (
        <div className="card max-w-2xl p-5">
          <Field label="Strategy">
            <Select value={asg.strategy} onChange={(e) => setAsg((p) => ({ ...p, strategy: e.target.value as typeof p.strategy }))} disabled={!editable}>
              <option value="round_robin">Round Robin — rotates fairly, pointer persists across restarts</option>
              <option value="least_leads">Least Leads — fewest open leads wins</option>
              <option value="least_workload">Least Active Workload — open follow-ups + tasks</option>
              <option value="location">Location Based — city → owner map below</option>
              <option value="category">Category Based — category → owner map below</option>
              <option value="priority">Priority Based — high value/urgent → senior owner</option>
              <option value="team">Team Based — team by industry/region, least-busy member</option>
              <option value="manual">Manual — no auto-assignment</option>
            </Select>
          </Field>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <Field label="Round-robin pointer (persisted)"><Input type="number" value={asg.rrPointer} onChange={(e) => setAsg((p) => ({ ...p, rrPointer: Number(e.target.value) }))} disabled={!editable} /></Field>
            <Field label="High-value threshold (₹)"><Input type="number" value={asg.highValueThreshold} onChange={(e) => setAsg((p) => ({ ...p, highValueThreshold: Number(e.target.value) }))} disabled={!editable} /></Field>
            <Field label="High-value owner"><Select value={asg.highValueUserId} onChange={(e) => setAsg((p) => ({ ...p, highValueUserId: e.target.value }))} disabled={!editable}><option value="">—</option>{d.users.filter((u) => u.isSales).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select></Field>
          </div>
          <div className="mt-3"><span className="lbl">Category → owner</span>
            {Object.entries(asg.categoryMap).map(([cat, usr]) => (
              <div key={cat} className="mb-1.5 flex items-center gap-2">
                <span className="w-44 truncate text-[12.5px]">{cat}</span>
                <Select className="!w-auto flex-1" value={usr} onChange={(e) => setAsg((p) => ({ ...p, categoryMap: { ...p.categoryMap, [cat]: e.target.value } }))} disabled={!editable}>{d.users.filter((u) => u.isSales).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select>
                {editable && <button className="text-ink-400 hover:text-red-500" onClick={() => setAsg((p) => { const m = { ...p.categoryMap }; delete m[cat]; return { ...p, categoryMap: m }; })}><Trash2 size={13} /></button>}
              </div>
            ))}
            {editable && <Select className="!w-auto" defaultValue="" onChange={(e) => { if (e.target.value) { setAsg((p) => ({ ...p, categoryMap: { ...p.categoryMap, [e.target.value]: d.users.find((u) => u.isSales)?.id || "" } })); e.target.value = ""; } }}><option value="" disabled>+ Map a category…</option>{["Digital Marketing Agency", "Software Company", "Manufacturing", "Real Estate", "E-commerce Store", "Interior Design"].filter((c) => !asg.categoryMap[c]).map((c) => <option key={c}>{c}</option>)}</Select>}
          </div>
          <div className="mt-3"><span className="lbl">Location → owner</span>
            {Object.entries(asg.locationMap).map(([city, usr]) => (
              <div key={city} className="mb-1.5 flex items-center gap-2">
                <span className="w-44 truncate text-[12.5px]">{city}</span>
                <Select className="!w-auto flex-1" value={usr} onChange={(e) => setAsg((p) => ({ ...p, locationMap: { ...p.locationMap, [city]: e.target.value } }))} disabled={!editable}>{d.users.filter((u) => u.isSales).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select>
                {editable && <button className="text-ink-400 hover:text-red-500" onClick={() => setAsg((p) => { const m = { ...p.locationMap }; delete m[city]; return { ...p, locationMap: m }; })}><Trash2 size={13} /></button>}
              </div>
            ))}
          </div>
          {editable && <div className="mt-4 flex justify-end"><Btn onClick={saveAsg}><Save size={14} /> Save assignment settings</Btn></div>}
        </div>
      )}

      {tab === "lists" && (
        <div className="grid gap-4 md:grid-cols-3">
          <div className="card p-4">
            <h3 className="hd mb-2 text-[14px]">Lead statuses</h3>
            {d.leadStatuses.map((s) => (
              <div key={s} className="mb-1.5 flex items-center justify-between rounded-md border border-ink-100 px-2.5 py-1.5 text-[12.5px] dark:border-ink-800">
                <Badge tone="slate">{s}</Badge>
                {editable && d.leads.every((l) => l.status !== s) && <button className="text-ink-300 hover:text-red-500" onClick={() => mutate((db) => { db.leadStatuses = db.leadStatuses.filter((x) => x !== s); })}><Trash2 size={12} /></button>}
              </div>
            ))}
            {editable && <div className="mt-2 flex gap-2"><Input value={newStatus} onChange={(e) => setNewStatus(e.target.value)} placeholder="New status" /><Btn size="sm" variant="soft" onClick={() => { if (newStatus.trim() && !d.leadStatuses.includes(newStatus.trim())) { mutate((db) => db.leadStatuses.push(newStatus.trim())); setNewStatus(""); } }}>Add</Btn></div>}
          </div>
          <div className="card p-4">
            <h3 className="hd mb-2 text-[14px]">Lead sources</h3>
            {d.leadSources.map((s) => (
              <div key={s} className="mb-1.5 flex items-center justify-between rounded-md border border-ink-100 px-2.5 py-1.5 text-[12.5px] dark:border-ink-800">
                <span>{s}</span>
                {editable && <button className="text-ink-300 hover:text-red-500" onClick={() => mutate((db) => { db.leadSources = db.leadSources.filter((x) => x !== s); })}><Trash2 size={12} /></button>}
              </div>
            ))}
            {editable && <div className="mt-2 flex gap-2"><Input value={newSource} onChange={(e) => setNewSource(e.target.value)} placeholder="New source" /><Btn size="sm" variant="soft" onClick={() => { if (newSource.trim() && !d.leadSources.includes(newSource.trim())) { mutate((db) => db.leadSources.push(newSource.trim())); setNewSource(""); } }}>Add</Btn></div>}
          </div>
          <div className="card p-4">
            <h3 className="hd mb-2 text-[14px]">Deal stages</h3>
            {[...d.dealStages].sort((a, b) => a.order - b.order).map((s) => (
              <div key={s.id} className="mb-1.5 flex items-center justify-between rounded-md border border-ink-100 px-2.5 py-1.5 text-[12.5px] dark:border-ink-800">
                <span className="flex items-center gap-2"><span className={`h-2 w-2 rounded-full ${s.kind === "won" ? "bg-emerald-500" : s.kind === "lost" ? "bg-red-400" : "bg-brand-500"}`} />{s.name}</span>
                <Badge tone="slate">{s.kind}</Badge>
              </div>
            ))}
            {editable && <div className="mt-2 flex gap-2"><Input value={newStage} onChange={(e) => setNewStage(e.target.value)} placeholder="New stage" /><Btn size="sm" variant="soft" onClick={() => { if (newStage.trim()) { mutate((db) => db.dealStages.push({ id: uid(), name: newStage.trim(), order: db.dealStages.filter((x) => x.kind === "open").length + 1, kind: "open" })); setNewStage(""); } }}>Add</Btn></div>}
          </div>
        </div>
      )}

      {tab === "data" && (
        <div className="max-w-2xl space-y-3">
          <div className="card flex items-center justify-between p-4">
            <div className="flex items-center gap-3"><Database size={18} className="text-brand-600" /><div><div className="text-[13.5px] font-semibold">Local database</div><div className="num text-[11.5px] text-ink-400">{storageKB()} KB · {d.leads.length} leads · {d.customers.length} customers · {d.activities.length} activity entries · persists across restarts</div></div></div>
            <Btn variant="outline" size="sm" onClick={() => { downloadFile(`itct-crm-backup-${todayISO()}.json`, JSON.stringify(d, null, 2), "application/json"); toast("Backup downloaded"); }}>Export backup</Btn>
          </div>
          <div className="card flex items-center justify-between border-amber-200 p-4 dark:border-amber-800">
            <div><div className="text-[13.5px] font-semibold">Reset demo data</div><div className="text-[11.5px] text-ink-400">Wipes all changes and restores the original seeded workspace.</div></div>
            <Btn variant="danger" size="sm" onClick={() => { if (window.confirm("Reset ALL data to the demo seed? This cannot be undone.")) { resetDB(); logAudit(user!.id, "Data Reset", "db", "Demo data restored"); toast("Database reset to demo seed", "warn"); } }}><Trash2 size={13} /> Reset</Btn>
          </div>
          <div className="card p-4 text-[11.5px] leading-relaxed text-ink-500">
            <b className="text-ink-700 dark:text-ink-200">Architecture note:</b> this build ships with an embedded, versioned database engine (tables, audit trail, background jobs) that mirrors the FastAPI/PostgreSQL service design — repositories, automation engine, discovery workers and Ollama client are all isolated behind the same service calls, ready to be pointed at a remote API.
          </div>
        </div>
      )}

      {tplEdit && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-ink-950/55 p-4 pt-[10vh] a-fade-in" onMouseDown={(e) => { if (e.target === e.currentTarget) setTplEdit(null); }}>
          <div className="a-scale-in w-full max-w-xl rounded-lg border border-ink-200 bg-surface p-5 shadow-2xl dark:border-ink-700 dark:bg-ink-900">
            <h3 className="hd text-[15px]">Edit template — {tplEdit.channel}</h3>
            <div className="mt-3 space-y-3">
              <Field label="Name"><Input value={tplBody.name} onChange={(e) => setTplBody((p) => ({ ...p, name: e.target.value }))} /></Field>
              {tplEdit.channel === "email" && <Field label="Subject"><Input value={tplBody.subject} onChange={(e) => setTplBody((p) => ({ ...p, subject: e.target.value }))} /></Field>}
              <Field label="Body"><Textarea rows={7} value={tplBody.body} onChange={(e) => setTplBody((p) => ({ ...p, body: e.target.value }))} /></Field>
            </div>
            <div className="mt-4 flex justify-end gap-2"><Btn variant="ghost" onClick={() => setTplEdit(null)}>Cancel</Btn>
              <Btn onClick={() => { if (!DEMO_MODE) { settingsApi.update({ templates: [{ id: Number(tplEdit.id), ...tplBody }] }).catch((e) => toast(e instanceof Error ? e.message : "Server save failed", "err")); } mutate((db) => { const t = db.templates.find((x) => x.id === tplEdit.id); if (t) Object.assign(t, tplBody); }); toast("Template saved"); setTplEdit(null); }}><Save size={14} /> Save template</Btn></div>
          </div>
        </div>
      )}
      <span className="hidden"><Money v={0} /><Toggle on={false} onChange={() => {}} /></span>
    </div>
  );
}
