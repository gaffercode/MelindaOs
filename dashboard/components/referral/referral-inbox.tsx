"use client";

import { useEffect, useMemo, useState } from "react";
import { profileFor } from "@/lib/referral/referral-checklist";
import { complaintFor } from "@/lib/referral/referral-complaints";
import { patientAgeLabel, referralDateLabel } from "@/lib/referral/referral-letter";
import {
  REFERRAL_STATUSES,
  REFERRAL_STATUS_LABELS,
  VITAL_KEYS,
  VITAL_LABELS,
  type ReferralStatus,
  type StoredReferral,
} from "@/lib/referral/referral-types";

type Filter = ReferralStatus | "semua";
const FILTERS: readonly Filter[] = ["semua", ...REFERRAL_STATUSES];

function receivedLabel(value: string): string {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("id-ID", { timeZone: "Asia/Jakarta", dateStyle: "medium", timeStyle: "short" }).format(parsed);
}

function minutesSince(value: string, now: number): number {
  const parsed = new Date(value).getTime();
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.floor((now - parsed) / 60_000));
}

function waitLabel(minutes: number): string {
  if (minutes < 60) return `${Math.max(1, minutes)} menit`;
  if (minutes < 24 * 60) return `${Math.floor(minutes / 60)} jam`;
  return `${Math.floor(minutes / (24 * 60))} hari`;
}

function phoneHrefs(phone: string): { whatsapp: string; call: string } | null {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 8) return null;
  const international = digits.startsWith("0") ? `62${digits.slice(1)}` : digits;
  return { whatsapp: `https://wa.me/${international}`, call: `tel:+${international}` };
}

export function ReferralInbox({ initial, initialStatus, unavailable, initialNow }: { initial: StoredReferral[]; initialStatus: Filter; unavailable: string; initialNow?: number }) {
  const [refreshing, setRefreshing] = useState(false);
  const [rows, setRows] = useState(initial);
  const [filter, setFilter] = useState<Filter>(initialStatus);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"baru" | "lama">("baru");
  const [now, setNow] = useState(initialNow ?? 0);
  const [copiedReference, setCopiedReference] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(initial[0]?.id ?? null);
  const [note, setNote] = useState("");
  const [csrf, setCsrf] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/access/session")
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { csrfToken?: string } | null) => { if (!cancelled && body?.csrfToken) setCsrf(body.csrfToken); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const tick = () => setNow(Date.now());
    const first = window.setTimeout(tick, 0);
    const timer = window.setInterval(tick, 60_000);
    return () => { window.clearTimeout(first); window.clearInterval(timer); };
  }, []);

  const counts = useMemo(() => {
    const map = new Map<Filter, number>([["semua", rows.length]]);
    for (const status of REFERRAL_STATUSES) map.set(status, rows.filter((row) => row.status === status).length);
    return map;
  }, [rows]);
  const newCount = rows.filter((row) => row.status === "baru").length;
  const needle = query.trim().toLowerCase();
  const searched = needle
    ? rows.filter((row) => {
        const haystack = [row.payload.patient.name, row.reference, row.payload.referrer.doctor, row.payload.referrer.facility, row.payload.clinical.diagnosis, complaintFor(row.payload.clinical.chiefComplaint)?.label ?? "", row.payload.referrer.city].join(" ").toLowerCase();
        return haystack.includes(needle);
      })
    : rows;
  const filtered = (filter === "semua" ? searched : searched.filter((row) => row.status === filter))
    .slice()
    .sort((a, b) => sort === "lama" ? a.receivedAt.localeCompare(b.receivedAt) : b.receivedAt.localeCompare(a.receivedAt));
  const selected = rows.find((row) => row.id === selectedId) ?? null;
  const profile = selected ? profileFor(selected.payload.clinical.profileId) : null;
  const contact = selected ? phoneHrefs(selected.payload.referrer.phone) : null;

  const refresh = () => {
    setRefreshing(true);
    window.location.reload();
  };

  async function copyReference() {
    if (!selected) return;
    try {
      await navigator.clipboard.writeText(selected.reference);
      setCopiedReference(true);
      window.setTimeout(() => setCopiedReference(false), 2000);
    } catch { /* clipboard unavailable */ }
  }

  async function move(status: ReferralStatus) {
    if (!selected) return;
    if (!csrf) { setError("Sesi belum siap. Muat ulang halaman lalu coba lagi."); return; }
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch(`/api/director/referrals/${selected.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
        body: JSON.stringify({ status, note }),
      });
      const body = (await response.json().catch(() => ({}))) as { referral?: StoredReferral; error?: string };
      const updated = body.referral;
      if (!response.ok || !updated) throw new Error(body.error ?? "Status rujukan belum dapat diubah.");
      setRows((current) => current.map((row) => (row.id === updated.id ? updated : row)));
      setNote("");
      setMessage(`Status diubah menjadi ${REFERRAL_STATUS_LABELS[status].toLowerCase()}.`);
    } catch (moveError) {
      setError((moveError as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="referral-inbox">
      <header className="referral-inbox-head">
        <div>
          <p className="referral-kicker">Lembar rujukan</p>
          <h1>Rujukan masuk</h1>
          <p>Rujukan dari FKTP, klinik, dan praktik dokter perorangan. Hubungi nomor perujuk sebelum memindahkan status.</p>
        </div>
        <div className="referral-inbox-head-actions">
          {newCount > 0 && <span className="referral-new-count">{newCount} baru</span>}
          <button type="button" className="referral-button-secondary" onClick={refresh} disabled={refreshing}>{refreshing ? "Memuat…" : "Muat ulang"}</button>
          <a className="referral-button-secondary" href="/rujukan" target="_blank" rel="noreferrer">Buka lembar rujukan</a>
        </div>
      </header>

      {unavailable && <p className="referral-error" role="status">{unavailable}</p>}

      <div className="referral-inbox-tools">
        <input type="search" aria-label="Cari rujukan" placeholder="Cari nama pasien, nomor rujukan, dokter, faskes…" value={query} onChange={(event) => setQuery(event.target.value)} />
        <div className="referral-sort" role="group" aria-label="Urutan rujukan">
          <button type="button" className={sort === "baru" ? "is-active" : undefined} aria-pressed={sort === "baru"} onClick={() => setSort("baru")}>Terbaru</button>
          <button type="button" className={sort === "lama" ? "is-active" : undefined} aria-pressed={sort === "lama"} onClick={() => setSort("lama")}>Terlama</button>
        </div>
        {query && <button type="button" className="referral-clear" onClick={() => setQuery("")}>Hapus pencarian</button>}
      </div>
      <p className="referral-inbox-count">{filtered.length} rujukan{query.trim() ? ` cocok dengan “${query.trim()}”` : ""}</p>

      <div className="referral-filters" role="tablist" aria-label="Saring status rujukan">
        {FILTERS.map((entry) => (
          <button key={entry} type="button" role="tab" aria-selected={filter === entry} className={filter === entry ? "is-active" : undefined} onClick={() => setFilter(entry)}>
            {entry === "semua" ? "Semua" : REFERRAL_STATUS_LABELS[entry]}
            <span>{counts.get(entry) ?? 0}</span>
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <p className="referral-inbox-empty">Belum ada rujukan untuk saringan ini.</p>
      ) : (
        <div className="referral-inbox-grid">
          <ol className="referral-inbox-list" aria-label="Daftar rujukan">
            {filtered.map((row) => (
              <li key={row.id}>
                <button type="button" className={row.id === selectedId ? "referral-inbox-row is-selected" : "referral-inbox-row"} onClick={() => { setSelectedId(row.id); setNote(""); setMessage(""); setError(""); setCopiedReference(false); }}>
                  <span className="referral-inbox-row-top"><strong>{row.payload.patient.name}</strong><span className={`referral-status referral-status-${row.status}`}>{REFERRAL_STATUS_LABELS[row.status]}</span></span>
                  <span className="referral-inbox-row-meta">{row.reference} · {row.payload.clinical.destination}</span>
                  <span className="referral-inbox-row-meta">{row.payload.clinical.diagnosis} · {receivedLabel(row.receivedAt)}</span>
                  {row.status === "baru" && <span className={`referral-inbox-wait${minutesSince(row.receivedAt, now) >= 120 ? " is-overdue" : ""}`}>Menunggu {waitLabel(minutesSince(row.receivedAt, now))}</span>}
                </button>
              </li>
            ))}
          </ol>

          <section className="referral-inbox-detail" aria-live="polite">
            {!selected || !profile ? (
              <p className="referral-inbox-empty">Pilih satu rujukan untuk melihat isinya.</p>
            ) : (
              <>
                <div className="referral-inbox-detail-head">
                  <div>
                    <p className="referral-kicker">{selected.reference} · {receivedLabel(selected.receivedAt)}</p>
                    <h2>{selected.payload.patient.name}</h2>
                    <p>
                      {selected.payload.patient.sex === "L" ? "Laki-laki" : selected.payload.patient.sex === "P" ? "Perempuan" : "Jenis kelamin belum diisi"}
                      {patientAgeLabel(selected.payload.patient, selected.payload.clinical.date) ? ` · ${patientAgeLabel(selected.payload.patient, selected.payload.clinical.date)}` : ""}
                      {selected.payload.patient.rm ? ` · RM ${selected.payload.patient.rm}` : ""}
                    </p>
                  </div>
                  <span className={`referral-status referral-status-${selected.status}`}>{REFERRAL_STATUS_LABELS[selected.status]}</span>
                </div>

                <div className="referral-contact-actions">
                  {contact && <a className="referral-button-secondary" href={contact.whatsapp} target="_blank" rel="noreferrer">WhatsApp perujuk</a>}
                  {contact && <a className="referral-button-secondary" href={contact.call}>Telepon perujuk</a>}
                  <button type="button" className="referral-button-secondary" onClick={copyReference}>{copiedReference ? "Nomor tersalin" : "Salin nomor rujukan"}</button>
                </div>

                <dl className="referral-inbox-facts">
                  <div><dt>Perujuk</dt><dd>{[selected.payload.referrer.doctor, selected.payload.referrer.facility, selected.payload.referrer.city].filter(Boolean).join(" · ")}</dd></div>
                  <div><dt>Kontak perujuk</dt><dd>{selected.payload.referrer.phone}</dd></div>
                  <div><dt>Keluhan utama</dt><dd>{complaintFor(selected.payload.clinical.chiefComplaint)?.label ?? "—"}</dd></div>
                  <div><dt>Diagnosis</dt><dd>{selected.payload.clinical.diagnosis} <small>({profile.label})</small></dd></div>
                  <div><dt>Alasan rujukan</dt><dd>{selected.payload.clinical.reason}</dd></div>
                  <div><dt>Tujuan</dt><dd>{selected.payload.clinical.destination} · {selected.payload.clinical.insurer}</dd></div>
                  <div><dt>Tanggal rujukan</dt><dd>{referralDateLabel(selected.payload.clinical.date)}{selected.payload.clinical.time ? `, ${selected.payload.clinical.time} WIB` : ""}</dd></div>
                  <div><dt>Tanda vital</dt><dd>{VITAL_KEYS.filter((key) => selected.payload.clinical.vitals[key].trim()).map((key) => `${VITAL_LABELS[key].label} ${selected.payload.clinical.vitals[key]} ${VITAL_LABELS[key].unit}`).join(" · ") || "—"}</dd></div>
                  <div><dt>Kelengkapan</dt><dd>{profile.items.filter((entry) => selected.payload.clinical.checks[entry.id]).map((entry) => entry.label).join("; ") || "—"}</dd></div>
                  <div><dt>Terapi</dt><dd>{selected.payload.clinical.therapy || "—"}</dd></div>
                  <div><dt>Alergi</dt><dd>{selected.payload.clinical.allergy || "—"}</dd></div>
                  {selected.payload.clinical.pregnancy && <div><dt>Kehamilan</dt><dd>{selected.payload.clinical.pregnancy}</dd></div>}
                  {selected.payload.clinical.notes && <div><dt>Catatan perujuk</dt><dd>{selected.payload.clinical.notes}</dd></div>}
                  {selected.note && <div><dt>Catatan tindak lanjut</dt><dd>{selected.note}</dd></div>}
                  {selected.handledBy && <div><dt>Ditangani oleh</dt><dd>{selected.handledBy}{selected.handledAt ? ` · ${receivedLabel(selected.handledAt)}` : ""}</dd></div>}
                </dl>

                {profile.note && <p className="referral-note">{profile.note}</p>}

                <label className="referral-field">
                  <span>Catatan tindak lanjut (opsional)</span>
                  <textarea value={note} maxLength={1000} rows={2} onChange={(event) => setNote(event.target.value)} placeholder="mis. Sudah dihubungi, pasien datang pukul 14.00" />
                </label>
                <div className="referral-actions">
                  {REFERRAL_STATUSES.filter((status) => status !== selected.status).map((status) => (
                    <button key={status} type="button" className={status === "diterima" ? "director-button" : "referral-button-secondary"} disabled={busy} onClick={() => move(status)}>
                      {REFERRAL_STATUS_LABELS[status]}
                    </button>
                  ))}
                </div>
                {message && <p className="referral-inbox-message" role="status">{message}</p>}
                {error && <p className="referral-error" role="alert">{error}</p>}
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
