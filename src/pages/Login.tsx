import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Eye, EyeOff, ArrowRight, ShieldCheck, Radar, IndianRupee, Database, FlaskConical } from "lucide-react";
import { useStore } from "../store";
import { DEMO_MODE } from "../lib/api";
import { Btn, Field, Input } from "../components/ui";
import GoogleSignIn from "../components/GoogleSignIn";

const demoAccounts = [
  { label: "Super Admin", email: "admin@crm.local", pw: "Admin@123" },
  { label: "Sales Manager", email: "rohit@itctcrm.in", pw: "Admin@123" },
  { label: "Sales Executive", email: "rahul@itctcrm.in", pw: "Sales@123" },
  { label: "Accountant", email: "neha@itctcrm.in", pw: "Sales@123" },
];

export default function Login() {
  const { login, toast } = useStore();
  const nav = useNavigate();
  const [email, setEmail] = useState(DEMO_MODE ? "admin@crm.local" : "");
  const [pw, setPw] = useState(DEMO_MODE ? "Admin@123" : "");
  const [show, setShow] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setBusy(true); setErr("");
    const r = await login(email, pw);
    setBusy(false);
    if (!r.ok) { setErr(r.error || "Login failed"); return; }
    toast("Welcome back", "ok", DEMO_MODE ? "Signed in to the demo workspace." : "Signed in to ITCT CRM.");
    nav("/dashboard");
  };

  return (
    <div className="flex min-h-screen">
      {/* brand panel */}
      <div className="side-tex relative hidden w-[46%] flex-col justify-between overflow-hidden bg-deep p-10 lg:flex">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-600 shadow-lg shadow-brand-900/50">
            <svg viewBox="0 0 32 32" width="24" height="24"><path d="M6 21c4.5-1 5.5-8 9-8s4.5 7 11 6" stroke="#F2C879" strokeWidth="3" fill="none" strokeLinecap="round" /><circle cx="6" cy="21" r="2.6" fill="#fff" /><circle cx="26" cy="19" r="2.6" fill="#fff" /></svg>
          </span>
          <div>
            <div className="font-display text-xl font-bold tracking-tight text-white">ITCT <span className="text-brand-300">CRM</span></div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/35">IT Cyber Technologies Pvt Ltd</div>
          </div>
        </div>

        <div className="max-w-md">
          <h1 className="a-fade-up font-display text-[34px] font-bold leading-[1.12] tracking-tight text-white">
            From first hello to <span className="text-amber-250">payment received</span> — one pipeline.
          </h1>
          <p className="a-fade-up mt-4 text-[14.5px] leading-relaxed text-white/55" style={{ animationDelay: "80ms" }}>
            Discovery, AI qualification, follow-ups, quotations, GST invoices and revenue analytics — wired end to end for Indian SMB teams.
          </p>
          <div className="a-fade-up mt-8 space-y-3.5" style={{ animationDelay: "160ms" }}>
            {[
              { icon: Radar, t: "Lead discovery jobs", s: "Targeted sourcing with duplicate control & validation" },
              { icon: ShieldCheck, t: "Rules + local AI scoring", s: "Works with Ollama, never breaks without it" },
              { icon: IndianRupee, t: "INR billing built-in", s: "Quotations → invoices → payments → outstanding" },
            ].map((f) => (
              <div key={f.t} className="flex items-start gap-3 rounded-lg border border-white/8 bg-white/[0.04] p-3.5">
                <f.icon size={17} className="mt-0.5 shrink-0 text-amber-250" />
                <div>
                  <div className="text-[13.5px] font-semibold text-white/90">{f.t}</div>
                  <div className="text-[12px] text-white/45">{f.s}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="num text-[11px] text-white/30">IT CYBER TECHNOLOGIES PVT LTD · owner: Kautuk Ade</div>
      </div>

      {/* form panel */}
      <div className="dot-grid flex flex-1 items-center justify-center bg-paper p-4 sm:p-6 dark:bg-[#0b1013]">
        <div className="a-scale-in w-full max-w-[410px]">
          <div className="mb-5 lg:hidden">
            <div className="font-display text-2xl font-bold text-ink-900 dark:text-ink-50">ITCT <span className="text-brand-500">CRM</span></div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-400">IT Cyber Technologies Pvt Ltd</div>
          </div>

          {DEMO_MODE ? (
            <div className="mb-3 flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-[11.5px] font-semibold leading-relaxed text-amber-800 dark:border-amber-800 dark:bg-amber-900/25 dark:text-amber-300">
              <FlaskConical size={14} className="mt-0.5 shrink-0" /> DEMO MODE — browser-only sample data (VITE_DEMO_MODE=true)
            </div>
          ) : (
            <div className="mb-3 flex items-start gap-2 rounded-md border border-brand-200 bg-brand-50 px-3 py-2 text-[11.5px] font-semibold leading-relaxed text-brand-700 dark:border-brand-800 dark:bg-brand-900/25 dark:text-brand-300">
              <Database size={14} className="mt-0.5 shrink-0" /> Secure company CRM workspace · Node.js + PostgreSQL
            </div>
          )}

          <div className="card p-5 sm:p-6">
            <h2 className="hd text-[19px]">Sign in</h2>
            <p className="mt-0.5 text-[13px] text-ink-500">{DEMO_MODE ? "Use a demo workspace account." : "Use your workspace account to continue."}</p>
            <form onSubmit={submit} className="mt-5 space-y-4">
              <Field label="Email" req>
                <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@itctcrm.in" autoComplete="email" autoFocus />
              </Field>
              <Field label="Password" req>
                <div className="relative">
                  <Input type={show ? "text" : "password"} value={pw} onChange={(e) => setPw(e.target.value)} placeholder="••••••••" autoComplete="current-password" />
                  <button type="button" onClick={() => setShow((s) => !s)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-400 hover:text-ink-600">
                    {show ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
              </Field>
              {err && (
                <div className="a-fade-up rounded-md border border-red-200 bg-red-50 px-3 py-2.5 text-[12.5px] font-medium text-red-700 dark:border-red-900 dark:bg-red-900/25 dark:text-red-300">
                  {err}
                  {!DEMO_MODE && err.includes("unavailable") && (
                    <div className="mt-1 font-normal text-red-500/90">Start the backend: <span className="num">cd backend · npm start</span></div>
                  )}
                </div>
              )}
              <Btn type="submit" loading={busy} className="w-full">
                Sign in <ArrowRight size={15} />
              </Btn>
            </form>

            {!DEMO_MODE && (
              <>
                <div className="my-4 flex items-center gap-3">
                  <div className="h-px flex-1 bg-ink-200 dark:bg-ink-700" />
                  <span className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-ink-400">or</span>
                  <div className="h-px flex-1 bg-ink-200 dark:bg-ink-700" />
                </div>
                <GoogleSignIn />
              </>
            )}

            {DEMO_MODE && (
              <div className="mt-5 border-t border-ink-100 pt-4 dark:border-ink-800">
                <div className="mb-2 text-[10.5px] font-bold uppercase tracking-[0.1em] text-ink-400">Demo accounts</div>
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                  {demoAccounts.map((a) => (
                    <button key={a.email} type="button" onClick={() => { setEmail(a.email); setPw(a.pw); setErr(""); }}
                      className="rounded-md border border-ink-200 px-2 py-1.5 text-left text-[11.5px] font-medium text-ink-600 transition-all hover:border-brand-400 hover:text-brand-700 dark:border-ink-700 dark:text-ink-300">
                      {a.label}
                      <span className="num block truncate text-[10px] font-normal text-ink-400">{a.email}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
          <p className="mt-4 text-center text-[11px] text-ink-400">
            {DEMO_MODE ? "Demo data lives only in this browser." : "Sessions use JWT with refresh-token rotation."}
          </p>
        </div>
      </div>
    </div>
  );
}
