/**
 * App store — auth, RBAC, toasts, theme.
 *
 * PRODUCTION (default): users, sessions and permissions come from the Node.js
 * (Express + PostgreSQL) backend (POST /auth/login → JWT pair, GET /auth/me →
 * user + perms). No local credential checks, no localStorage business data.
 * After login the store hydrates every collection from PostgreSQL.
 *
 * DEMO MODE (VITE_DEMO_MODE=true, dev only): browser-embedded workspace, clearly
 * labelled in the UI. Never active by default.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { getDB, hashPass, mutate, uid } from "./lib/db";
import { logAudit, runSweeps, resumeStaleJobs } from "./lib/services";
import { DEMO_MODE, authApi, backendAvailable, clearTokens, hasSession, setTokens } from "./lib/api";
import { fromApiUser } from "./lib/mappers";
import { hydrateFromBackend } from "./lib/hydrate";
import type { MeResponse } from "./lib/apiTypes";
import type { ModuleKey, Perm, User } from "./lib/types";

const SKEY = "itct.session"; // demo mode only

export interface Toast { id: string; title: string; body?: string; kind: "ok" | "err" | "info" | "warn"; }

interface StoreCtx {
  user: User | null;
  mode: "backend" | "demo";
  roleName: string;
  booting: boolean;
  serverDown: boolean;
  retryBoot: () => void;
  login: (email: string, pw: string) => Promise<{ ok: boolean; error?: string }>;
  logout: () => void;
  can: (m: ModuleKey, p?: Perm) => boolean;
  toasts: Toast[];
  toast: (title: string, kind?: Toast["kind"], body?: string) => void;
  dropToast: (id: string) => void;
  dark: boolean;
  toggleDark: () => void;
}

const Ctx = createContext<StoreCtx | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [perms, setPerms] = useState<Record<string, string[]>>({});
  const [isSuper, setIsSuper] = useState(false);
  const [roleName, setRoleName] = useState("");
  const [booting, setBooting] = useState(true);
  const [serverDown, setServerDown] = useState(false);
  const [bootKey, setBootKey] = useState(0);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"));
  const mode: "backend" | "demo" = DEMO_MODE ? "demo" : "backend";
  const retryBoot = useCallback(() => { setBooting(true); setServerDown(false); setBootKey((k) => k + 1); }, []);

  // demo-mode boot: sweeps + stored demo session
  useEffect(() => {
    if (!DEMO_MODE) return;
    runSweeps();
    resumeStaleJobs();
    try {
      const id = localStorage.getItem(SKEY);
      if (id) {
        const u = getDB().users.find((x) => x.id === id);
        if (u && u.active) {
          setUser(u);
          setRoleName(getDB().roles.find((r) => r.id === u.roleId)?.name || "");
        }
      }
    } catch { /* ignore */ }
    setServerDown(false);
    setBooting(false);
  }, [bootKey]);

  // production boot: probe server → access token → GET /auth/me → hydrate from PostgreSQL
  useEffect(() => {
    if (DEMO_MODE) return;
    let live = true;
    (async () => {
      const up = await backendAvailable();
      if (!live) return;
      if (!up) { setServerDown(true); setBooting(false); return; }
      setServerDown(false);
      if (hasSession()) {
        try {
          const me = (await authApi.me()).data as MeResponse;
          await hydrateFromBackend(me.perms || {}, me.is_super);
          if (!live) return;
          setUser(fromApiUser(me.user));
          setPerms(me.perms || {});
          setIsSuper(me.is_super);
          setRoleName(me.role || "");
        } catch {
          clearTokens(); // refresh failed → back to login
        }
      }
      setBooting(false);
    })();
    return () => { live = false; };
  }, [bootKey]);

  const login = useCallback(async (email: string, pw: string) => {
    if (!DEMO_MODE) {
      try {
        const r = await authApi.login(email.trim(), pw);
        setTokens(r.data.access_token, r.data.refresh_token);
        const me = (await authApi.me()).data as MeResponse;
        await hydrateFromBackend(me.perms || {}, me.is_super); // load only modules this role can view
        setUser(fromApiUser(me.user));
        setPerms(me.perms || {});
        setIsSuper(me.is_super);
        setRoleName(me.role || "");
        return { ok: true };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : "Login failed." };
      }
    }
    // ---- demo mode only: embedded workspace credentials ----
    const d = getDB();
    const u = d.users.find((x) => x.email.toLowerCase() === email.trim().toLowerCase());
    if (!u) { logAudit("system", "Failed Login", "auth", `Unknown email ${email}`); return { ok: false, error: "No account found for this email." }; }
    if (!u.active) { logAudit(u.id, "Failed Login", "auth", "Account disabled"); return { ok: false, error: "This account has been disabled. Contact your admin." }; }
    if (u.passHash !== hashPass(pw)) { logAudit(u.id, "Failed Login", "auth", "Wrong password"); return { ok: false, error: "Incorrect password. Try again." }; }
    mutate((db) => { const x = db.users.find((y) => y.id === u.id); if (x) x.lastLogin = new Date().toISOString(); });
    logAudit(u.id, "Login", "auth", "Successful login (demo mode)");
    try { localStorage.setItem(SKEY, u.id); } catch { /* ignore */ }
    setUser({ ...u });
    setRoleName(d.roles.find((r) => r.id === u.roleId)?.name || "");
    setServerDown(false);
    return { ok: true };
  }, []);

  const logout = useCallback(() => {
    if (!DEMO_MODE) {
      authApi.logout().catch(() => { /* best effort */ });
      clearTokens();
    } else if (user) {
      logAudit(user.id, "Logout", "auth", "Signed out");
      try { localStorage.removeItem(SKEY); } catch { /* ignore */ }
    }
    setUser(null);
    setPerms({});
    setIsSuper(false);
  }, [user]);

  const can = useCallback((m: ModuleKey, p: Perm = "view") => {
    if (!user) return false;
    if (!DEMO_MODE) {
      if (isSuper) return true;
      return !!perms[m]?.includes(p);
    }
    const u = getDB().users.find((x) => x.id === user.id);
    if (!u) return false;
    const role = getDB().roles.find((r) => r.id === u.roleId);
    if (!role) return false;
    if (role.id === "r_super" || role.id === "r_admin") return true;
    return !!role.perms[m]?.includes(p);
  }, [user, perms, isSuper]);

  const toast = useCallback((title: string, kind: Toast["kind"] = "ok", body?: string) => {
    const id = uid();
    setToasts((t) => [...t.slice(-3), { id, title, body, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200);
  }, []);
  const dropToast = useCallback((id: string) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  const toggleDark = useCallback(() => {
    setDark((d) => {
      const next = !d;
      document.documentElement.classList.toggle("dark", next);
      try { localStorage.setItem("itct.theme", next ? "dark" : "light"); } catch { /* ignore */ }
      return next;
    });
  }, []);

  return (
    <Ctx.Provider value={{ user, mode, roleName, booting, serverDown, retryBoot, login, logout, can, toasts, toast, dropToast, dark, toggleDark }}>
      {children}
    </Ctx.Provider>
  );
}

export function useStore(): StoreCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useStore outside provider");
  return v;
}
