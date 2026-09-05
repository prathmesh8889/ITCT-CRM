import { useSyncExternalStore } from "react";
import type { DB } from "./types";

const KEY = "itct.db.v2";

export function uid(): string {
  return Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
}

export function hashPass(pw: string): string {
  let h1 = 0xdeadbeef ^ 7, h2 = 0x41c6ce57 ^ 7;
  for (let i = 0; i < pw.length; i++) {
    const ch = pw.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507); h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507); h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, "0") + (h1 >>> 0).toString(16).padStart(8, "0");
}

function blankDB(): DB {
  return {
    v: 2,
    users: [], roles: [], teams: [],
    leads: [], leadSources: [], leadStatuses: [], discoveryJobs: [],
    customers: [], companies: [], contacts: [],
    deals: [], dealStages: [],
    followups: [], calls: [], meetings: [], tasks: [], notes: [],
    products: [], quotations: [], invoices: [], payments: [], expenses: [],
    activities: [], notices: [], auditLogs: [],
    rules: [], ruleRuns: [], templates: [], aiLogs: [],
    settings: {
      company: {
        name: "ITCT CRM", tagline: "", email: "", phone: "", website: "", address: "",
        gstin: "", pan: "", currency: "INR", timezone: "Asia/Kolkata", logoMark: "I",
      },
      ai: { url: "http://localhost:11434", model: "qwen3", temperature: 0.4, timeoutSec: 30 },
      scoring: {
        phone: 10, email: 10, website: 10, location: 10, industry: 15, rating: 5, engagement: 20,
        targetLocations: [], targetIndustries: [],
      },
      assignment: {
        strategy: "round_robin", rrPointer: 0, highValueThreshold: 100000, highValueUserId: "",
        categoryMap: {}, locationMap: {},
      },
    },
  };
}

function load(): DB {
  try {
    // Remove the old browser-only demo database from previous builds.
    localStorage.removeItem("itct.db.v1");
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as DB;
      if (parsed && parsed.v === 2 && Array.isArray(parsed.leads)) return parsed;
    }
  } catch { /* corrupted -> blank workspace */ }
  const clean = blankDB();
  try { localStorage.setItem(KEY, JSON.stringify(clean)); } catch { /* storage full */ }
  return clean;
}

let state: DB = load();
let snap = { db: state, rev: 0 };
const listeners = new Set<() => void>();

export function getDB(): DB { return state; }

export function commit(): void {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* ignore quota */ }
  snap = { db: state, rev: snap.rev + 1 };
  listeners.forEach((l) => l());
}

/** Mutate the database in place, then persist + notify subscribers. */
export function mutate<T>(fn: (d: DB) => T): T {
  const r = fn(state);
  commit();
  return r;
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function useDB(): DB {
  return useSyncExternalStore(subscribe, () => snap).db;
}

export function resetDB(): void {
  state = blankDB();
  commit();
}

export function storageKB(): number {
  try { return Math.round((localStorage.getItem(KEY) || "").length / 1024); } catch { return 0; }
}
