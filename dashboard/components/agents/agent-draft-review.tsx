"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { longDate, wibDate, wibTime } from "@/lib/director/director-data";
import type { AgentDraft, AgentDraftSummary } from "@/lib/agent/agent-draft-review-api";
import { LoadingState } from "../loading-state";
import { sessionResponse } from "@/lib/client-api";

const UNAVAILABLE = "Draf dari agent belum tersedia.";

export type AgentDraftPanelProps = {
  pending: AgentDraftSummary[]; accepted: AgentDraftSummary[]; selected: AgentDraft | null;
  reason: string; busy: boolean; loading: boolean; error: string; message: string;
  onSelect: (id: string) => void; onReason: (value: string) => void;
  onDecide: (decision: "accepted" | "rejected") => void; onReload: () => void;
};

function received(value: string): string {
  return `${longDate(wibDate(new Date(value)))} · ${wibTime(value)}`;
}
function Meta({ draft }: { draft: AgentDraftSummary }) {
  return <><span>{draft.producer} · Kategori {draft.category}</span><small>Diterima {received(draft.receivedAt)}</small></>;
}

export function AgentDraftPanel({ pending, accepted, selected, reason, busy, loading, error, message, onSelect, onReason, onDecide, onReload }: AgentDraftPanelProps) {
  return <section className="director-review-preview" aria-label="Draf dari agent">
    <h2>Draf dari agent</h2>
    <p className="director-notice">Diterima berarti siap diunduh untuk dimasukkan ke handbook. Dokumen baru berlaku setelah lolos pemeriksaan format.</p>
    {error && <p role="alert" className="director-notice director-error">{error}</p>}{message && <p role="status" className="director-notice">{message}</p>}
    <button type="button" className="button-secondary" disabled={loading || busy} onClick={onReload}>Muat ulang draf</button>
    {loading ? <p className="director-empty"><LoadingState label="Memuat draf" /></p> : error && !pending.length && !accepted.length ? null : <div className="director-review-grid">
      <div>
        <section className="chart-panel"><div className="chart-panel-heading"><h3>Menunggu tinjauan</h3></div><div className="chart-panel-surface director-panel-surface">
          {pending.length ? <ul className="director-review-list">{pending.map((draft) => <li key={draft.id}><button type="button" disabled={busy} aria-pressed={selected?.id === draft.id} onClick={() => onSelect(draft.id)}><strong>{draft.title}</strong><Meta draft={draft} /></button></li>)}</ul> : <p className="director-empty">Tidak ada draf yang menunggu.</p>}
        </div></section>
        <section className="chart-panel"><div className="chart-panel-heading"><h3>Sudah diterima</h3></div><div className="chart-panel-surface director-panel-surface">
          {accepted.length ? <ul className="director-list">{accepted.map((draft) => <li key={draft.id}><strong>{draft.title}</strong><p className="director-note"><Meta draft={draft} /></p><a className="button-secondary" href={`/api/director/agent-drafts/${encodeURIComponent(draft.id)}/unduh`}>Unduh berkas</a></li>)}</ul> : <p className="director-empty">Belum ada draf yang diterima.</p>}
        </div></section>
      </div>
      <section className="chart-panel"><div className="chart-panel-heading"><h3>Isi draf</h3></div><div className="chart-panel-surface director-panel-surface">{selected ? <>
        <h4>{selected.title}</h4>
        <p className="director-report-note">{[`${selected.producer} · Kategori ${selected.category}`, selected.docId && `Dokumen: ${selected.docId}`, selected.domain && `Bidang: ${selected.domain}`, selected.department && `Unit: ${selected.department}`].filter(Boolean).join(" · ")}</p>
        {selected.note && <p className="director-note">Catatan agent: {selected.note}</p>}
        {selected.source && <p className="director-note">Sumber: {selected.source}</p>}
        <div className="director-review-diff"><pre style={{ maxHeight: "28rem", overflow: "auto" }}>{selected.content}</pre></div>
        <label className="director-review-reason">Alasan penolakan<textarea value={reason} disabled={busy} maxLength={1000} onChange={(event) => onReason(event.target.value)} placeholder="Wajib diisi jika menolak draf. Agent pengirim dapat membacanya." /></label>
        <div className="director-review-actions"><button className="director-button" type="button" disabled={busy} onClick={() => onDecide("accepted")}>Terima</button><button className="button-secondary" type="button" disabled={busy || !reason.trim()} onClick={() => onDecide("rejected")}>Tolak</button></div>
      </> : <p className="director-empty">Pilih draf untuk membaca isinya.</p>}</div></section>
    </div>}
  </section>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function nullableText(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}
function toSummary(value: unknown): AgentDraftSummary | null {
  if (!isRecord(value)) return null;
  const { id, producer, title, category, docId, domain, department, note, source, status, receivedAt, reviewedAt, reviewNote } = value;
  if (typeof id !== "string" || typeof producer !== "string" || typeof title !== "string") return null;
  if (category !== "A" && category !== "B" && category !== "C") return null;
  if (status !== "submitted" && status !== "accepted" && status !== "rejected") return null;
  if (typeof receivedAt !== "string" || !Number.isFinite(Date.parse(receivedAt))) return null;
  if (!nullableText(docId) || !nullableText(domain) || !nullableText(department) || !nullableText(note) || !nullableText(source) || !nullableText(reviewedAt) || !nullableText(reviewNote)) return null;
  return { id, producer, title, category, docId, domain, department, note, source, status, receivedAt, reviewedAt, reviewNote };
}
function toList(value: unknown): AgentDraftSummary[] {
  if (!isRecord(value) || !Array.isArray(value.submissions)) throw new Error(UNAVAILABLE);
  return value.submissions.map((item: unknown) => {
    const summary = toSummary(item);
    if (!summary) throw new Error(UNAVAILABLE);
    return summary;
  });
}
function toDraft(value: unknown): AgentDraft {
  const submission = isRecord(value) ? value.submission : null;
  const summary = toSummary(submission);
  if (!summary || !isRecord(submission) || typeof submission.content !== "string") throw new Error(UNAVAILABLE);
  return { ...summary, content: submission.content };
}
async function failure(response: Response): Promise<Error> {
  if (response.status === 401) window.location.assign(new URL("/director-login?returnTo=%2Fdirector-review", window.location.origin));
  const body: unknown = await response.json().catch(() => null);
  return new Error(isRecord(body) && typeof body.error === "string" && body.error ? body.error : UNAVAILABLE);
}
async function getJson(url: string, signal?: AbortSignal): Promise<unknown> {
  const response = await fetch(url, { cache: "no-store", signal });
  if (!response.ok) throw await failure(response);
  return response.json().catch((error: unknown) => { throw signal?.aborted ? error : new Error(UNAVAILABLE); });
}
async function loadAll(signal?: AbortSignal) {
  const sessionReply = await sessionResponse(signal);
  if (!sessionReply.ok) throw await failure(sessionReply);
  const session: unknown = await sessionReply.json().catch((error: unknown) => { throw signal?.aborted ? error : new Error(UNAVAILABLE); });
  if (!isRecord(session) || typeof session.csrfToken !== "string") throw new Error(UNAVAILABLE);
  const pending = toList(await getJson("/api/director/agent-drafts?status=submitted", signal));
  const accepted = toList(await getJson("/api/director/agent-drafts?status=accepted", signal));
  return { csrf: session.csrfToken, pending, accepted };
}

export function AgentDraftReview() {
  const [csrf, setCsrf] = useState(""), [pending, setPending] = useState<AgentDraftSummary[]>([]), [accepted, setAccepted] = useState<AgentDraftSummary[]>([]), [selected, setSelected] = useState<AgentDraft | null>(null);
  const [reason, setReason] = useState(""), [busy, setBusy] = useState(false), [loading, setLoading] = useState(true), [error, setError] = useState(""), [message, setMessage] = useState("");
  const inFlight = useRef(false), selecting = useRef<AbortController | null>(null);
  const apply = useCallback((data: Awaited<ReturnType<typeof loadAll>>) => {
    setCsrf(data.csrf); setPending(data.pending); setAccepted(data.accepted); setSelected(null); setReason("");
  }, []);
  async function reload() {
    selecting.current?.abort(); setLoading(true);
    try { apply(await loadAll()); } catch (caught) { setSelected(null); setError(caught instanceof Error ? caught.message : UNAVAILABLE); }
    finally { setLoading(false); }
  }
  useEffect(() => {
    const controller = new AbortController();
    void loadAll(controller.signal).then((data) => { if (!controller.signal.aborted) apply(data); })
      .catch((caught: unknown) => { if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : UNAVAILABLE); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => { controller.abort(); selecting.current?.abort(); };
  }, [apply]);
  async function select(id: string) {
    selecting.current?.abort();
    const controller = new AbortController();
    selecting.current = controller;
    setError(""); setMessage(""); setReason(""); setSelected(null);
    try {
      const draft = toDraft(await getJson(`/api/director/agent-drafts/${encodeURIComponent(id)}`, controller.signal));
      if (!controller.signal.aborted) setSelected(draft);
    } catch (caught) { if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : UNAVAILABLE); }
  }
  async function decide(decision: "accepted" | "rejected") {
    if (!selected || inFlight.current || (decision === "rejected" && !reason.trim())) return;
    inFlight.current = true; setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch(`/api/director/agent-drafts/${encodeURIComponent(selected.id)}`, { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf }, body: JSON.stringify(decision === "rejected" ? { decision, note: reason.trim() } : { decision }) });
      if (response.status === 409) { setError("Draf ini sudah diputuskan."); await reload(); return; }
      if (!response.ok) throw await failure(response);
      const body: unknown = await response.json().catch(() => null);
      if (!isRecord(body) || typeof body.replayed !== "boolean") throw new Error(UNAVAILABLE);
      setMessage(body.replayed ? "Draf ini sudah diputuskan." : decision === "accepted" ? "Draf diterima. Unduh berkasnya di daftar di bawah." : "Draf ditolak. Agent pengirim dapat membaca alasannya.");
      await reload();
    } catch (caught) { setError(caught instanceof Error ? caught.message : UNAVAILABLE); }
    finally { inFlight.current = false; setBusy(false); }
  }
  return <AgentDraftPanel pending={pending} accepted={accepted} selected={selected} reason={reason} busy={busy} loading={loading} error={error} message={message}
    onSelect={(id) => void select(id)} onReason={setReason} onDecide={(decision) => void decide(decision)} onReload={() => { setError(""); setMessage(""); void reload(); }} />;
}
