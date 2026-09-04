import { useEffect, useRef, useState } from "react";
import { Bot, Send, Sparkles, WifiOff, Plug, RefreshCw, ShieldCheck } from "lucide-react";
import { useStore } from "../store";
import { useDB } from "../lib/db";
import { assistantReply, ollamaPing } from "../lib/services";
import { Btn, Badge, Reveal, Skeleton } from "../components/ui";

interface Msg { role: "user" | "ai"; text: string; usedAI?: boolean; }

const CHIPS = [
  "Summarize our hottest lead",
  "Explain pipeline risks",
  "Compare salesperson performance",
  "Draft a WhatsApp introduction",
  "What should I do today?",
];

export default function Assistant() {
  const { user } = useStore();
  const d = useDB();
  const [msgs, setMsgs] = useState<Msg[]>([{ role: "ai", text: `Hi ${user?.name.split(" ")[0]} — I'm your ITCT sales copilot. I read live data from your CRM: ask me to summarize leads, suggest next actions, draft WhatsApp/email messages, flag pipeline risks, or compare the team. I never send messages or change records on my own.` }]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [ai, setAi] = useState<{ ok: boolean; models: string[]; error?: string } | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const s = d.settings.ai;

  const ping = () => { setAi(null); ollamaPing(s.url, 3500).then(setAi); };
  useEffect(() => { ping(); /* on mount */ // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs, busy]);

  const send = async (text?: string) => {
    const q = (text ?? input).trim();
    if (!q || busy) return;
    setInput("");
    setMsgs((m) => [...m, { role: "user", text: q }]);
    setBusy(true);
    const { reply, usedAI } = await assistantReply(q);
    setMsgs((m) => [...m, { role: "ai", text: reply, usedAI }]);
    setBusy(false);
  };

  return (
    <div className="mx-auto grid max-w-[1200px] gap-4 p-4 md:p-6 lg:grid-cols-[1fr_300px]">
      <div className="card flex h-[calc(100vh-120px)] flex-col overflow-hidden">
        <div className="flex items-center gap-2.5 border-b border-ink-200/70 px-4 py-3 dark:border-ink-700">
          <span className="flex h-8 w-8 items-center justify-center rounded-md bg-brand-600 text-white"><Bot size={16} /></span>
          <div className="flex-1">
            <div className="hd text-[14px]">AI Sales Assistant</div>
            <div className="text-[11px] text-ink-400">{ai === null ? "Checking Ollama…" : ai.ok ? `Ollama connected · ${s.model}` : "Offline mode — built-in heuristic engine"}</div>
          </div>
          <Badge tone={ai === null ? "slate" : ai.ok ? "green" : "amber"}>{ai === null ? "…" : ai.ok ? "AI online" : "Rules engine"}</Badge>
        </div>
        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          {msgs.map((m, i) => (
            <div key={i} className={`a-fade-up flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[85%] whitespace-pre-wrap rounded-lg px-3.5 py-2.5 text-[13px] leading-relaxed ${m.role === "user" ? "bg-brand-600 text-white" : "border border-ink-200/80 bg-ink-50 text-ink-800 dark:border-ink-700 dark:bg-ink-800 dark:text-ink-100"}`}>
                {m.text}
                {m.role === "ai" && m.usedAI !== undefined && (
                  <div className="mt-1.5 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider opacity-60">
                    <Sparkles size={10} /> {m.usedAI ? "Ollama model" : "heuristic engine"}
                  </div>
                )}
              </div>
            </div>
          ))}
          {busy && <div className="flex justify-start"><div className="rounded-lg border border-ink-200/80 bg-ink-50 px-4 py-3 dark:border-ink-700 dark:bg-ink-800"><Skeleton className="h-3 w-40" /></div></div>}
          <div ref={endRef} />
        </div>
        <div className="border-t border-ink-200/70 p-3 dark:border-ink-700">
          <div className="mb-2 flex flex-wrap gap-1.5">
            {CHIPS.map((c) => <button key={c} onClick={() => send(c)} className="rounded-full border border-brand-200 bg-brand-50/60 px-2.5 py-1 text-[11px] font-medium text-brand-700 transition-all hover:bg-brand-100 dark:border-brand-800 dark:bg-brand-900/25 dark:text-brand-200">{c}</button>)}
          </div>
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); send(); }}>
            <input className="inp flex-1" value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask about a lead, the pipeline, or draft a message…" />
            <Btn type="submit" loading={busy}><Send size={14} /></Btn>
          </form>
        </div>
      </div>

      <div className="space-y-3">
        <Reveal><div className="card p-4">
          <h3 className="hd mb-2 flex items-center gap-2 text-[14px]"><Plug size={14} className="text-brand-600" /> AI Connection</h3>
          {ai === null ? <Skeleton className="h-16" /> : ai.ok ? (
            <div>
              <div className="flex items-center gap-2 text-[12.5px] font-semibold text-emerald-600"><span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" /> Ollama reachable</div>
              <div className="num mt-1 text-[11.5px] text-ink-400">{s.url}</div>
              <div className="mt-2"><span className="lbl">Available models</span>
                <div className="flex flex-wrap gap-1">{(ai.models.length ? ai.models : [s.model]).map((mm) => <Badge key={mm} tone={mm === s.model ? "teal" : "slate"}>{mm}</Badge>)}</div>
              </div>
            </div>
          ) : (
            <div>
              <div className="flex items-center gap-2 text-[12.5px] font-semibold text-amber-600"><WifiOff size={14} /> AI temporarily unavailable</div>
              <p className="mt-1 text-[11.5px] leading-relaxed text-ink-400">Ollama isn't reachable at <span className="num">{s.url}</span>. The CRM keeps working — qualification and the assistant fall back to the deterministic rules engine. Start Ollama (<span className="num">ollama serve</span>) and re-test.</p>
            </div>
          )}
          <Btn variant="outline" size="sm" className="mt-3" onClick={ping}><RefreshCw size={12} /> Test connection</Btn>
        </div></Reveal>
        <Reveal delay={70}><div className="card p-4">
          <h3 className="hd mb-2 flex items-center gap-2 text-[14px]"><ShieldCheck size={14} className="text-brand-600" /> Guardrails</h3>
          <ul className="space-y-1.5 text-[11.5px] leading-relaxed text-ink-500">
            <li>• AI never overwrites business data without your review — scores are applied only when you click “Run AI qualification”.</li>
            <li>• Messages are drafted, never sent. WhatsApp/email open in your own apps.</li>
            <li>• No paid APIs required; everything runs against your local Ollama.</li>
          </ul>
        </div></Reveal>
        <Reveal delay={140}><div className="card p-4">
          <h3 className="hd mb-2 text-[14px]">Recent AI activity</h3>
          {d.aiLogs.length === 0 ? <p className="text-[11.5px] text-ink-400">No AI calls yet this session.</p> : (
            <div className="max-h-[260px] space-y-1.5 overflow-y-auto">
              {d.aiLogs.slice(0, 12).map((l) => (
                <div key={l.id} className="rounded-md border border-ink-100 p-2 dark:border-ink-800">
                  <div className="flex items-center justify-between"><Badge tone={l.model === "rules-engine" || l.model === "heuristic" ? "amber" : "teal"}>{l.kind}</Badge><span className="num text-[10px] text-ink-400">{l.ms}ms</span></div>
                  <div className="mt-1 truncate text-[10.5px] text-ink-400">{l.output}</div>
                </div>
              ))}
            </div>
          )}
        </div></Reveal>
      </div>
    </div>
  );
}
