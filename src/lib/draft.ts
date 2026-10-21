import { useEffect } from 'react';

// Unsent builder drafts (Raise PO, Quote Machine) kept in this browser, per
// user, so switching tabs or screens doesn't lose them. They expire a day
// after the last edit. Storage can be unavailable (private mode, blocked site
// data) — then drafts simply aren't kept.
export const DRAFT_HOURS = 24;
const TTL_MS = DRAFT_HOURS * 60 * 60 * 1000;

export function readDraft<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const { at, data } = JSON.parse(raw) as { at: number; data: T };
    if (!at || Date.now() - at > TTL_MS) { localStorage.removeItem(key); return null; }
    return data ?? null;
  } catch { return null; }
}

export function clearDraft(key: string) {
  try { localStorage.removeItem(key); } catch { /* storage unavailable */ }
}

/** Writes `value` under `key` whenever it changes while `keep` is true; removes it when false. */
export function useDraftSync(key: string, value: unknown, keep: boolean) {
  const json = JSON.stringify(value);
  useEffect(() => {
    try {
      if (keep) localStorage.setItem(key, JSON.stringify({ at: Date.now(), data: JSON.parse(json) }));
      else localStorage.removeItem(key);
    } catch { /* storage unavailable */ }
  }, [key, json, keep]);
}
