"use client";

/** Browser-only storage for notes that live in this browser, never on a server. Confirmations go through the shared Rare UI toast. */
export function readLocal<T>(key: string): T | null {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) as T : null; } catch { return null; }
}
export function writeLocal(key: string, value: unknown): void {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage blocked: the note stays in memory only */ }
}
