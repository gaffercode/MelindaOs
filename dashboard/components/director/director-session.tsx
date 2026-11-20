"use client";
import { useState } from "react";
/** `kind="account"` signs a staff or vice director account out; the Director session route answers accounts 401, so it is never called for them. */
export function DirectorSession({ kind = "director" }: { kind?: "director" | "account" }) {
  const route = kind === "account" ? "/api/access/session" : "/api/director/session";
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function logout() {
    if (busy) return;
    setBusy(true); setError("");
    try {
      const session = await fetch(route, { cache: "no-store" });
      if (session.status === 401) { window.location.assign(new URL("/director-login", window.location.origin)); return; }
      if (!session.ok) throw new Error("Sesi belum dapat diperiksa.");
      const { csrfToken } = await session.json() as { csrfToken: string };
      const response = await fetch(route, { method: "DELETE", headers: { "X-CSRF-Token": csrfToken } });
      if (!response.ok) throw new Error("Belum dapat keluar. Coba lagi.");
      window.location.assign(new URL("/director-login", window.location.origin));
    } catch (error) { setError(error instanceof Error ? error.message : "Belum dapat keluar."); setBusy(false); }
  }
  return <div className="director-session"><button type="button" onClick={logout} disabled={busy} aria-busy={busy}>{busy ? "Memproses…" : "Keluar"}</button>{error && <span role="alert">{error}</span>}</div>;
}
