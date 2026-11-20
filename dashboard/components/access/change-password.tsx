"use client";

import { type FormEvent, useEffect, useRef, useState } from "react";
import type { PublicPrincipal } from "@/lib/access/access-control";

const NETWORK_ERROR = "Tidak dapat menghubungi server. Coba lagi.";
const MIN_LENGTH = 12;
const INPUT = "h-11 w-full min-w-0 rounded-lg border border-[var(--line)] bg-transparent px-3";

/** The account session's CSRF token, or null when it cannot be read (the submit then reads it again). */
async function loadCsrf(): Promise<string | null> {
  try {
    const response = await fetch("/api/access/session", { cache: "no-store" });
    if (!response.ok) return null;
    const body: unknown = await response.json();
    return typeof body === "object" && body !== null && "csrfToken" in body && typeof body.csrfToken === "string" ? body.csrfToken : null;
  } catch { return null; }
}

/** Own-password change for account principals. The Director has no account password (the passcode comes from server
 * configuration and the API answers the account cookie only), so the Director sees a note instead of a form. The server
 * stays the authority on length and on the current password; the two client checks only save a round trip. */
export function ChangePassword({ principal }: { principal: PublicPrincipal | null }) {
  const account = principal?.kind === "account";
  const [current, setCurrent] = useState(""), [next, setNext] = useState(""), [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const csrf = useRef<string | null>(null);
  const inFlight = useRef(false);

  useEffect(() => {
    if (!account) return;
    let live = true;
    void loadCsrf().then((token) => { if (live) csrf.current = token; });
    return () => { live = false; };
  }, [account]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;
    if (next !== again) { setError("Password baru tidak sama."); return; }
    if (next.length < MIN_LENGTH) { setError(`Password minimal ${MIN_LENGTH} karakter.`); return; }
    inFlight.current = true; setBusy(true); setError("");
    try {
      const token = csrf.current ?? await loadCsrf();
      const response = await fetch("/api/access/password", {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json", ...(token ? { "X-CSRF-Token": token } : {}) },
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
      }).catch(() => { throw new Error(NETWORK_ERROR); });
      const result = await response.json().catch(() => null) as { error?: string; returnTo?: string } | null;
      if (!response.ok) throw new Error(result?.error ?? "Belum dapat mengganti password. Coba lagi.");
      window.location.assign(result?.returnTo ?? "/");
    } catch (caught) { setError(caught instanceof Error ? caught.message : NETWORK_ERROR); inFlight.current = false; setBusy(false); }
  }

  return <>
    <header>
      <h1 className="m-0 text-[length:var(--type-title)] font-medium">Ganti password</h1>
      {principal?.mustChange && <p className="m-0 mt-1 text-[var(--muted)]">Anda masuk dengan password sementara. Buat password baru untuk melanjutkan.</p>}
    </header>
    {!account ? <p className="m-0 text-[var(--muted)]">Passcode Direktur diatur lewat konfigurasi server.</p> : (
      <form onSubmit={submit} aria-busy={busy} noValidate className="grid max-w-sm gap-3">
        <label className="grid gap-1">Password saat ini<input className={INPUT} type="password" name="currentPassword" autoComplete="current-password" maxLength={256} required disabled={busy} value={current} onChange={(event) => setCurrent(event.target.value)} /></label>
        <label className="grid gap-1">Password baru<input className={INPUT} type="password" name="newPassword" autoComplete="new-password" maxLength={256} required disabled={busy} value={next} onChange={(event) => setNext(event.target.value)} /></label>
        <label className="grid gap-1">Ulangi password baru<input className={INPUT} type="password" name="repeatPassword" autoComplete="new-password" maxLength={256} required disabled={busy} value={again} onChange={(event) => setAgain(event.target.value)} /></label>
        <p className="m-0 text-[var(--muted)]">Minimal {MIN_LENGTH} karakter.</p>
        {error && <p role="alert" className="m-0 text-[var(--orange-ink)]">{error}</p>}
        <button type="submit" className="h-11 rounded-lg border border-[var(--line)] px-4 font-medium disabled:opacity-60" disabled={busy}>Simpan password</button>
      </form>
    )}
  </>;
}
