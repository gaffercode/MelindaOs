"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";

const NETWORK_ERROR = "Tidak dapat menghubungi server. Coba lagi.";

/** Account sign-in: POST /api/access/session with { email, password, returnTo }. The server sets the account cookie
 * and answers the path to open (a forced password change goes to /ganti-password), which this form follows as given.
 * No welcome veil here: its text is the Director's greeting. */
export function AccountForm({ returnTo, hidden }: { returnTo: string; hidden: boolean }) {
  const [email, setEmail] = useState(""), [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const inFlight = useRef(false);
  const emailField = useRef<HTMLInputElement>(null);
  useEffect(() => { if (!hidden) emailField.current?.focus({ preventScroll: true }); }, [hidden]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current || !email.trim() || !password) return;
    inFlight.current = true; setBusy(true); setError("");
    try {
      const response = await fetch("/api/access/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password, returnTo }),
      }).catch(() => { throw new Error(NETWORK_ERROR); });
      const result = await response.json().catch(() => null) as { error?: string; returnTo?: string } | null;
      if (!response.ok) throw new Error(result?.error ?? "Belum dapat masuk. Coba lagi.");
      window.location.assign(result?.returnTo ?? "/");
    } catch (caught) { setError(caught instanceof Error ? caught.message : NETWORK_ERROR); inFlight.current = false; setBusy(false); }
  }

  return (
    <form className="entrance-form entrance-account" onSubmit={submit} aria-busy={busy} hidden={hidden} noValidate>
      <div className="entrance-field">
        <label htmlFor="account-email" className="entrance-label">Email</label>
        <div className="entrance-control"><input ref={emailField} id="account-email" type="email" name="email" autoComplete="username" maxLength={254} required disabled={busy} value={email} onChange={(event) => setEmail(event.target.value)} aria-invalid={error ? true : undefined} /></div>
      </div>
      <div className="entrance-field">
        <label htmlFor="account-password" className="entrance-label">Password</label>
        <div className="entrance-control"><input id="account-password" type="password" name="password" autoComplete="current-password" maxLength={256} required disabled={busy} value={password} onChange={(event) => setPassword(event.target.value)} aria-invalid={error ? true : undefined} /></div>
      </div>
      <button type="submit" className="entrance-submit entrance-submit-wide" disabled={busy || !email.trim() || !password}>{busy ? "Memeriksa…" : "Masuk"}</button>
      <p role={error ? "alert" : "status"} className={error ? "entrance-error" : "entrance-note"}>{error}</p>
    </form>
  );
}
