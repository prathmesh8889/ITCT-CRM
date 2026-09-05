import { useEffect, useRef, useState } from "react";
import { api, setTokens } from "../lib/api";

type GoogleCredentialResponse = { credential?: string };
type GoogleIdApi = {
  initialize: (options: { client_id: string; callback: (response: GoogleCredentialResponse) => void; auto_select?: boolean; cancel_on_tap_outside?: boolean }) => void;
  renderButton: (parent: HTMLElement, options: Record<string, unknown>) => void;
};

declare global {
  interface Window {
    google?: { accounts?: { id?: GoogleIdApi } };
  }
}

const SCRIPT_ID = "google-identity-services";
const CLIENT_ID = String(import.meta.env.VITE_GOOGLE_CLIENT_ID || "").trim();

export default function GoogleSignIn() {
  const ref = useRef<HTMLDivElement>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!CLIENT_ID) return;
    let cancelled = false;

    const render = () => {
      if (cancelled || !ref.current || !window.google?.accounts?.id) return;
      const width = Math.max(220, Math.min(360, Math.floor(ref.current.getBoundingClientRect().width || 320)));
      ref.current.innerHTML = "";
      window.google.accounts.id.initialize({
        client_id: CLIENT_ID,
        auto_select: false,
        cancel_on_tap_outside: true,
        callback: async (response) => {
          if (!response.credential) { setErr("Google did not return a sign-in credential."); return; }
          setBusy(true); setErr("");
          try {
            const r = await api.post<{ access_token: string; refresh_token: string; token_type: string }>("/auth/google", { credential: response.credential });
            setTokens(r.data.access_token, r.data.refresh_token);
            window.location.hash = "#/dashboard";
            window.location.reload();
          } catch (e) {
            setErr(e instanceof Error ? e.message : "Google sign-in failed.");
            setBusy(false);
          }
        },
      });
      window.google.accounts.id.renderButton(ref.current, {
        type: "standard",
        theme: "outline",
        size: "large",
        text: "signin_with",
        shape: "rectangular",
        logo_alignment: "left",
        width,
      });
    };

    const existing = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
    if (existing) {
      if (window.google?.accounts?.id) render();
      else existing.addEventListener("load", render, { once: true });
      return () => { cancelled = true; existing.removeEventListener("load", render); };
    }

    const script = document.createElement("script");
    script.id = SCRIPT_ID;
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.onload = render;
    script.onerror = () => setErr("Could not load Google sign-in. Check your internet connection.");
    document.head.appendChild(script);
    return () => { cancelled = true; };
  }, []);

  if (!CLIENT_ID) return null;

  return (
    <div>
      <div ref={ref} className={`flex min-h-[44px] w-full items-center justify-center ${busy ? "pointer-events-none opacity-60" : ""}`} />
      {err && <div className="mt-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[12px] font-medium text-red-700 dark:border-red-900 dark:bg-red-900/25 dark:text-red-300">{err}</div>}
      <p className="mt-2 text-center text-[10.5px] leading-relaxed text-ink-400">Only active ITCT CRM employees whose Google email matches their CRM email can sign in.</p>
    </div>
  );
}
