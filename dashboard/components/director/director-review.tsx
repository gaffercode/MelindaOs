"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { DirectorShell } from "./director-shell";
import { DirectorCenter } from "./director-center";
import { longDate, wibTime } from "@/lib/director/director-data";
import type { ReviewQueue, Revision } from "@/lib/director/director-api";
import { LoadingState } from "../loading-state";
import { sessionResponse } from "@/lib/client-api";
import type { PublicPrincipal } from "@/lib/access/access-control";
import { AgentDraftReview } from "../agents/agent-draft-review";

export function ReviewActions({ confirmed, reason, busy, onReview }: { confirmed: boolean; reason: string; busy: boolean; onReview: (action: "approve-and-publish" | "reject") => void }) {
  return <div className="director-review-actions"><button className="director-button" type="button" disabled={busy || !confirmed} onClick={() => onReview("approve-and-publish")}>Tandai sudah diperiksa</button><button className="button-secondary" type="button" disabled={busy || !reason.trim()} onClick={() => onReview("reject")}>Tolak laporan</button></div>;
}
async function readResponse<T>(response: Response): Promise<T> {
  const body = await response.json() as T & { error?: string };
  if (!response.ok) {
    if (response.status === 401) window.location.assign(new URL("/director-login?returnTo=%2Fdirector-review", window.location.origin));
    throw new Error(body.error ?? "Permintaan gagal. Coba lagi.");
  }
  return body;
}
const labels = { schedule: "Jadwal Direktur", agenda: "Agenda", priorities: "Prioritas", decisions: "Keputusan", followUps: "Tindak lanjut", dailyReport: "Laporan harian", brief: "Brief kondisi rumah sakit" };
export async function loadDirectorReview(date: string, signal?: AbortSignal) {
  const session = await readResponse<{ csrfToken: string }>(await sessionResponse(signal));
  const queue = await readResponse<ReviewQueue>(await fetch(`/api/director/reviews?${new URLSearchParams({ tanggal: date })}`, { cache: "no-store", signal }));
  return { session, queue };
}
export function DirectorReview({ date, principal, allowedPages }: { date: string; principal?: PublicPrincipal | null; allowedPages?: string[] }) {
  const [queue, setQueue] = useState<ReviewQueue | null>(null), [selectedId, setSelectedId] = useState<string | null>(null), [csrf, setCsrf] = useState("");
  const [confirmed, setConfirmed] = useState(false), [reason, setReason] = useState(""), [busy, setBusy] = useState(false), [loading, setLoading] = useState(true), [error, setError] = useState(""), [message, setMessage] = useState("");
  const inFlight = useRef(false), operation = useRef<{ signature: string; key: string } | null>(null);
  const apply = useCallback(({ session, queue }: Awaited<ReturnType<typeof loadDirectorReview>>) => {
    setCsrf(session.csrfToken); setQueue(queue); setSelectedId(null); setConfirmed(false); setReason(""); operation.current = null;
  }, []);
  async function reload() {
    setLoading(true); setError(""); setConfirmed(false);
    try {
      apply(await loadDirectorReview(date));
    } catch (error) { setError(error instanceof Error ? error.message : "Antrean belum dapat dibaca."); }
    finally { setLoading(false); }
  }
  useEffect(() => {
    const controller = new AbortController();
    void loadDirectorReview(date, controller.signal).then((data) => { if (!controller.signal.aborted) apply(data); })
      .catch((error: unknown) => { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "Antrean belum dapat dibaca."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [date, apply]);
  const selected = queue?.pending.find((revision) => revision.id === selectedId);
  async function review(action: "approve-and-publish" | "reject") {
    if (!selected || !queue || inFlight.current || (action === "approve-and-publish" && !confirmed) || (action === "reject" && !reason.trim())) return;
    const body = { action, payloadHash: selected.payload_hash, expectedPublishedRevisionId: queue.publishedRevisionId, ...(action === "reject" ? { reason: reason.trim() } : {}) };
    const signature = JSON.stringify({ id: selected.id, ...body });
    if (operation.current?.signature !== signature) operation.current = { signature, key: crypto.randomUUID() };
    inFlight.current = true; setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch(`/api/director/reviews/${selected.id}`, { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf, "Idempotency-Key": operation.current.key }, body: JSON.stringify(body) });
      if (response.status === 409) { await reload(); throw new Error("Versi publikasi berubah. Buka draf dan periksa kembali sebelum mengonfirmasi."); }
      await readResponse(response);
      setMessage(action === "reject" ? "Laporan ditolak. Dashboard membaca versi valid lain jika tersedia." : "Pemeriksaan dicatat. Laporan tetap tersedia di dashboard.");
      await reload();
    } catch (error) { setError(error instanceof Error ? error.message : "Review belum tersimpan. Coba lagi dengan isi yang sama."); }
    finally { inFlight.current = false; setBusy(false); }
  }
  function select(revision: Revision) { setSelectedId(revision.id); setConfirmed(false); setReason(""); setMessage(""); setError(""); operation.current = null; }
  return <DirectorShell date={date} pending={queue?.pending.length ?? null} authenticated principal={principal} allowedPages={allowedPages}><div className="page-content director-page">
    <header className="page-heading"><div><span className="director-eyebrow">MelindaOS · Review direksi</span><h1>Review laporan harian</h1><p>{longDate(date)} · WIB</p></div><Link className="director-knowledge" href={`/?tanggal=${date}`}>Buka dashboard</Link></header>
    <form className="director-date-form" method="get" action="/director-review"><label htmlFor="review-date">Tanggal laporan</label><div><input id="review-date" type="date" name="tanggal" defaultValue={date} required /><button className="director-button" type="submit">Tampilkan</button></div></form>
    <p className="director-notice">Laporan yang tersimpan langsung tampil di dashboard setelah lolos validasi. Pemeriksaan ini opsional untuk mencatat pengecekan sumber atau menolak laporan yang perlu dikoreksi.</p>
    {error && <p role="alert" className="director-notice director-error">{error}</p>}{message && <p role="status" className="director-notice">{message}</p>}
    <button type="button" className="button-secondary" disabled={loading || busy} onClick={() => void reload()}>Muat ulang antrean</button>
    {loading ? <p className="director-empty"><LoadingState label="Memuat antrean" /></p> : <div className="director-review-grid"><section className="chart-panel"><div className="chart-panel-heading"><h2>Laporan belum diperiksa</h2></div><div className="chart-panel-surface director-panel-surface">{queue?.pending.length ? <ul className="director-review-list">{queue.pending.map((revision) => <li key={revision.id}><button type="button" disabled={busy} aria-pressed={selectedId === revision.id} onClick={() => select(revision)}><strong>{revision.producer}</strong><span>Diterima {wibTime(revision.received_at)}</span><small>Versi {revision.id.slice(0, 8)}</small></button></li>)}</ul> : <p className="director-empty">Tidak ada laporan yang belum diperiksa untuk tanggal ini.</p>}<p className="director-report-note">Maksimal 50 kiriman terbaru. Versi diperiksa: {queue?.publishedRevisionId?.slice(0, 8) ?? "belum ada"}.</p></div></section>
      <section className="chart-panel"><div className="chart-panel-heading"><h2>Pemeriksaan sumber dan isi</h2></div><div className="chart-panel-surface director-panel-surface">{selected ? <>
        <p className="director-report-note">Revision: {selected.id}<br />Hash: {selected.payload_hash}</p>
        <h3>Sumber dan periode</h3><ul className="director-list">{Object.entries(selected.payload.provenance).map(([group, source]) => <li key={group}><strong>{group} · {source.source.label}</strong><p>{source.periodStart}–{source.periodEnd} · diamati {wibTime(source.sourceObservedAt)}{source.cutoff && ` · cutoff ${source.cutoff} WIB`}</p><p className="director-note">Referensi: {source.source.reference}</p><dl>{Object.entries(source.metricDefinitions).map(([metric, definition]) => <div key={metric}><dt>{metric}</dt><dd>{definition}</dd></div>)}</dl></li>)}</ul>
        <h3>Perubahan dibanding versi diperiksa</h3>{Object.entries(labels).map(([key, label]) => {
          const field = key as keyof typeof labels;
          const before = queue?.published?.brief[field], after = selected.payload.brief[field];
          return JSON.stringify(before) === JSON.stringify(after) ? null : <details className="director-review-diff" key={key}><summary>{label}</summary><div><strong>Sebelumnya</strong><pre>{before === undefined ? "Belum ada versi diperiksa" : JSON.stringify(before, null, 2)}</pre><strong>Kiriman</strong><pre>{after === undefined ? "Belum tersedia" : JSON.stringify(after, null, 2)}</pre></div></details>;
        })}
        <label className="director-review-confirm"><input type="checkbox" checked={confirmed} disabled={busy} onChange={(event) => setConfirmed(event.target.checked)} />Saya telah memeriksa sumber, angka agregat, periode, dan tidak adanya data pasien individual.</label>
        <label className="director-review-reason">Alasan penolakan<textarea value={reason} disabled={busy} maxLength={500} onChange={(event) => setReason(event.target.value)} placeholder="Wajib diisi jika menolak laporan" /></label>
        <ReviewActions confirmed={confirmed} reason={reason} busy={busy} onReview={(action) => void review(action)} />
      </> : <p className="director-empty">Pilih laporan untuk memeriksa isi dan sumbernya.</p>}</div></section></div>}
    {selected && <section aria-label="Pratinjau laporan" className="director-review-preview"><h2>Isi kiriman</h2><DirectorCenter embedded result={{ data: selected.payload.brief, status: "available", message: "PRATINJAU KIRIMAN · dashboard menampilkan versi valid terbaru untuk tanggal ini", provenance: selected.payload.provenance }} today={date} /></section>}
    <AgentDraftReview />
  </div></DirectorShell>;
}
