import { useSyncExternalStore } from "react";
import type { DB } from "./types";
import { buildSeed } from "./seed";

const KEY = "itct.db.v1";

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

function load(): DB {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as DB;
      if (parsed && parsed.v === 1 && Array.isArray(parsed.leads)) return parsed;
    }
  } catch { /* corrupted -> reseed */ }
  const seeded = buildSeed();
  try { localStorage.setItem(KEY, JSON.stringify(seeded)); } catch { /* storage full */ }
  return seeded;
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
  state = buildSeed();
  commit();
}

export function storageKB(): number {
  try { return Math.round((localStorage.getItem(KEY) || "").length / 1024); } catch { return 0; }
}
