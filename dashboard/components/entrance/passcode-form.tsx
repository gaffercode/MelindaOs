"use client";
import { ArrowRight, Eye, EyeOff } from "lucide-react";
import { useRef, useState, type FormEvent } from "react";
import { CatSit } from "./cat-sit";

export const UNAVAILABLE_MESSAGE = "Layanan login belum dikonfigurasi. Hubungi administrator untuk mengaktifkan akses aman.";

/** Director passcode form. Authentication is unchanged: POST /api/director/session with { passcode, returnTo },
 * the server sets the session cookie, and the browser navigates to the returned path. `beforeNavigate` lets the
 * entrance play its exit before the location changes. An in-flight ref blocks duplicate submissions. */
export function PasscodeForm({ available, returnTo, beforeNavigate, hidden }: { available: boolean; returnTo: string; beforeNavigate?: () => Promise<void>; hidden?: boolean }) {
  const [passcode, setPasscode] = useState("");
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const inFlight = useRef(false);
  const locked = !available || busy;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!available || inFlight.current || !passcode) return;
    inFlight.current = true; setBusy(true); setError("");
    try {
      const response = await fetch("/api/director/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passcode, returnTo }),
      });
      const result = await response.json() as { error?: string; returnTo?: string };
      if (!response.ok) throw new Error(result.error ?? "Belum dapat masuk. Coba lagi.");
      await beforeNavigate?.();
      window.location.assign(result.returnTo ?? "/");
    } catch (error) { setError(error instanceof Error ? error.message : "Koneksi gagal. Coba lagi."); inFlight.current = false; setBusy(false); }
  }
  return (
    <form className="entrance-form" onSubmit={submit} aria-busy={busy} hidden={hidden} noValidate>
      <div className="entrance-field" data-entrance="field" style={{ opacity: 0 }}>
        <label htmlFor="director-passcode" className="entrance-label">Passcode</label>
        <div className="entrance-control">
          <CatSit />
          <input id="director-passcode" data-entrance-input="" type={shown ? "text" : "password"} name="passcode" autoComplete="current-password" maxLength={256} required disabled={locked} value={passcode} onChange={(event) => setPasscode(event.target.value)} aria-describedby="director-login-status" aria-invalid={error ? true : undefined} />
          <button type="button" className="entrance-eye" onClick={() => setShown((value) => !value)} aria-label={shown ? "Sembunyikan passcode" : "Tampilkan passcode"} aria-pressed={shown} disabled={!available}>
            {shown ? <EyeOff size={18} strokeWidth={1.75} aria-hidden="true" /> : <Eye size={18} strokeWidth={1.75} aria-hidden="true" />}
          </button>
          <button type="submit" className="entrance-submit" disabled={locked || !passcode} aria-label={busy ? "Memeriksa passcode" : "Masuk"}>
            {busy ? <span className="entrance-spinner" aria-hidden="true" /> : <ArrowRight size={18} strokeWidth={2} aria-hidden="true" />}
          </button>
        </div>
      </div>
      <p id="director-login-status" role={error ? "alert" : "status"} data-entrance="status" className={error ? "entrance-error" : "entrance-note"} style={{ opacity: 0 }}>
        {error || (available ? "" : UNAVAILABLE_MESSAGE)}
      </p>
    </form>
  );
}
