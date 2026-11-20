"use client";

import { type FormEvent, useCallback, useEffect, useState } from "react";
import { ACCOUNT_ROLES, ROLE_LABELS, type Role } from "@/lib/access/access-control";
import { directorCsrfHeaders } from "@/lib/client-api";

type Account = { id: string; email: string; displayName: string; role: Role; mustChange: boolean; disabled: boolean; updatedAt: string };
type AuditEvent = { actor: string | null; action: string; target: string | null; createdAt: string };
type Issued = { email: string; password: string };

const ACTION_LABELS: Record<string, string> = {
  login_ok: "Masuk berhasil", login_fail: "Masuk gagal", logout: "Keluar", user_create: "Akun dibuat", user_update: "Akun diubah",
  user_disable: "Akun dinonaktifkan", user_enable: "Akun diaktifkan", password_reset: "Password direset", password_change: "Password diganti",
};
const INPUT = "h-11 w-full min-w-0 rounded-lg border border-[var(--line)] bg-transparent px-3";
const BUTTON = "h-11 rounded-lg border border-[var(--line)] px-4 font-medium disabled:opacity-60";

const when = (iso: string) => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jakarta" }).format(date);
};

const NETWORK_ERROR = "Tidak dapat menghubungi server. Coba lagi.";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** An error whose text came from the server's own `error` field (or is already fixed Indonesian); anything else shows NETWORK_ERROR. */
class ApiError extends Error {}
const messageOf = (caught: unknown) => caught instanceof ApiError ? caught.message : NETWORK_ERROR;

function errorText(body: unknown): string {
  return typeof body === "object" && body !== null && "error" in body && typeof body.error === "string" ? body.error : "Layanan akun belum tersedia.";
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init }).catch(() => { throw new ApiError(NETWORK_ERROR); });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new ApiError(errorText(body));
  return body as T;
}

async function write<T>(url: string, method: "POST" | "PATCH", body?: object): Promise<T> {
  const headers: Record<string, string> = { ...(await directorCsrfHeaders().catch(() => { throw new ApiError(NETWORK_ERROR); })), ...(body ? { "Content-Type": "application/json" } : {}) };
  return call<T>(url, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) });
}

/** Director-only account management. A temporary password lives in React state only until dismissed. */
export function UserManagement() {
  const [users, setUsers] = useState<Account[]>([]);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [issued, setIssued] = useState<Issued | null>(null);
  const [copied, setCopied] = useState(false);
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState<Role | "">("");

  const refresh = useCallback(async () => {
    const [list, audit] = await Promise.all([call<{ users: Account[] }>("/api/access/users"), call<{ events: AuditEvent[] }>("/api/access/audit")]);
    setUsers(list.users); setEvents(audit.events);
  }, []);

  useEffect(() => {
    let live = true;
    (async () => {
      const list = await call<{ users: Account[] }>("/api/access/users");
      if (live) setUsers(list.users);
      const audit = await call<{ events: AuditEvent[] }>("/api/access/audit");
      if (live) setEvents(audit.events);
    })().catch((caught: unknown) => { if (live) setError(messageOf(caught)); });
    return () => { live = false; };
  }, []);

  async function act(task: () => Promise<void>) {
    setBusy(true); setError("");
    try { await task(); await refresh().catch(() => undefined); } catch (caught: unknown) { setError(messageOf(caught)); } finally { setBusy(false); }
  }
  // Audit ids that are account UUIDs show the account's email; an id not in the loaded list stays as is.
  const known = (value: string) => UUID.test(value) ? users.find((user) => user.id === value)?.email ?? value : value;
  function issue(target: string, password: string) { setIssued({ email: target, password }); setCopied(false); }

  function create(event: FormEvent) {
    event.preventDefault();
    if (!role) return;
    void act(async () => {
      const result = await write<{ user: Account; temporaryPassword: string }>("/api/access/users", "POST", { email: email.trim(), displayName: displayName.trim(), role });
      setUsers((current) => [...current, result.user]);
      issue(result.user.email, result.temporaryPassword);
      setEmail(""); setDisplayName("");
    });
  }
  const toggle = (user: Account) => act(async () => {
    const result = await write<{ user: Account }>(`/api/access/users/${user.id}`, "PATCH", { disabled: !user.disabled });
    setUsers((current) => current.map((item) => item.id === user.id ? result.user : item));
  });
  const reset = (user: Account) => act(async () => {
    const result = await write<{ temporaryPassword: string }>(`/api/access/users/${user.id}/password`, "POST");
    issue(user.email, result.temporaryPassword);
  });
  async function copy() {
    if (!issued) return;
    try { await navigator.clipboard.writeText(issued.password); setCopied(true); } catch { setError("Tidak bisa menyalin. Salin password secara manual."); }
  }

  return <>
    <header>
      <h1 className="m-0 text-[length:var(--type-title)] font-medium">Pengguna</h1>
      <p className="m-0 mt-1 text-[var(--muted)]">Akun staf dan wakil direktur. Hanya Direktur yang dapat mengelola akun.</p>
    </header>

    {error && <p role="alert" className="m-0 text-[var(--orange-ink)]">{error}</p>}

    {issued && <section aria-label="Password sementara" className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4">
      <h2 className="m-0 text-[length:var(--type-title-sm)] font-medium">Password sementara untuk {issued.email}</h2>
      <p className="m-0 mt-1 text-[var(--muted)]">Tampil sekali ini saja. Berikan kepada pemilik akun; ia wajib menggantinya saat masuk pertama.</p>
      <p className="m-0 mt-3"><code className="rounded-lg border border-[var(--line)] px-3 py-2 font-mono">{issued.password}</code></p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" className={BUTTON} onClick={() => void copy()}>Salin</button>
        <button type="button" className={BUTTON} onClick={() => { setIssued(null); setCopied(false); }}>Tutup</button>
        {copied && <span role="status" className="text-[var(--muted)]">Tersalin.</span>}
      </div>
    </section>}

    <section aria-labelledby="users-create-title" className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4">
      <h2 id="users-create-title" className="m-0 text-[length:var(--type-title-sm)] font-medium">Buat akun</h2>
      <form onSubmit={create} className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="grid gap-1"><label htmlFor="user-email">Email</label><input id="user-email" type="email" required maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} className={INPUT} /></div>
        <div className="grid gap-1"><label htmlFor="user-name">Nama</label><input id="user-name" required maxLength={80} value={displayName} onChange={(event) => setDisplayName(event.target.value)} className={INPUT} /></div>
        <div className="grid gap-1"><label htmlFor="user-role">Peran</label>
          <select id="user-role" required value={role} onChange={(event) => setRole(ACCOUNT_ROLES.find((item) => item === event.target.value) ?? "")} className={INPUT}>
            <option value="">Pilih peran</option>
            {ACCOUNT_ROLES.map((item) => <option key={item} value={item}>{ROLE_LABELS[item]}</option>)}
          </select>
        </div>
        <div className="flex items-end"><button type="submit" disabled={busy} className={`${BUTTON} w-full bg-[var(--accent)] text-white`}>Buat akun</button></div>
      </form>
    </section>

    <section aria-labelledby="users-list-title">
      <h2 id="users-list-title" className="m-0 mb-3 text-[length:var(--type-title-sm)] font-medium">Akun</h2>
      <div className="swiss-table-wrap">
        <table className="swiss-table">
          <thead><tr>
            <th scope="col" className="text-left">Email</th><th scope="col" className="text-left">Nama</th><th scope="col" className="text-left">Peran</th>
            <th scope="col" className="text-left">Status</th><th scope="col" className="text-left">Diubah</th><th scope="col" className="text-left"><span className="sr-only">Tindakan</span></th>
          </tr></thead>
          <tbody>
            {users.map((user) => <tr key={user.id}>
              <th scope="row" className="text-left">{user.email}</th>
              <td className="text-left">{user.displayName}</td>
              <td className="text-left">{ROLE_LABELS[user.role]}</td>
              <td className="text-left">{user.disabled ? "Nonaktif" : user.mustChange ? "Aktif, belum ganti password" : "Aktif"}</td>
              <td className="text-left">{when(user.updatedAt)}</td>
              <td className="text-left"><div className="flex flex-wrap gap-2">
                <button type="button" disabled={busy} className={BUTTON} onClick={() => void toggle(user)}>{user.disabled ? "Aktifkan" : "Nonaktifkan"}</button>
                <button type="button" disabled={busy} className={BUTTON} onClick={() => void reset(user)}>Reset password</button>
              </div></td>
            </tr>)}
          </tbody>
        </table>
      </div>
      {users.length === 0 && <p className="m-0 text-[var(--muted)]">Belum ada akun.</p>}
    </section>

    <section aria-labelledby="users-audit-title">
      <h2 id="users-audit-title" className="m-0 mb-3 text-[length:var(--type-title-sm)] font-medium">Audit</h2>
      {events.length === 0
        ? <p className="m-0 text-[var(--muted)]">Belum ada catatan.</p>
        : <ul className="m-0 grid list-none gap-2 p-0">
          {events.map((item, index) => <li key={`${item.createdAt}-${index}`} className="rounded-xl border border-[var(--line)] p-3">
            <strong>{ACTION_LABELS[item.action] ?? item.action}</strong>{item.target ? ` · ${known(item.target)}` : ""}
            <p className="m-0 mt-1 text-[var(--muted)]">{when(item.createdAt)}{item.actor ? ` · oleh ${UUID.test(item.actor) ? known(item.actor) : "Direktur"}` : ""}</p>
          </li>)}
        </ul>}
    </section>
  </>;
}
