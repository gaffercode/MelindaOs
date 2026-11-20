"use client";

import { useEffect, useState, type FormEvent } from "react";
import { actionLabels, instructionStatuses, type InstructionAction } from "@/lib/director/director-instructions";
import type { StaffReply } from "@/lib/tasks/store";
import { LoadingState } from "../loading-state";
import { SourceInfo } from "../source-info";
import { clockWib, httpsAttachments, readJson, taskStatusLabels, type BoardTask } from "./board-client";

type ArchiveRowData = Omit<BoardTask, "overdue" | "reminder"> & Partial<Pick<BoardTask, "overdue" | "reminder">>;
type Filters = { dari: string; sampai: string; q: string; pic: string; status: string; semua: boolean };
const empty: Filters = { dari: "", sampai: "", q: "", pic: "", status: "", semua: false };
const statusOptions = [...instructionStatuses, "ditunda", "dibatalkan"];

const monthNames = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];

/** The current month (`YYYY-MM`) and the 11 before it, newest first, labelled in Indonesian. */
export function recapMonths(current: string): { value: string; label: string }[] {
  const [year, month] = current.split("-").map(Number);
  return Array.from({ length: 12 }, (_, back) => {
    const index = year * 12 + (month - 1) - back, y = Math.floor(index / 12), m = index % 12;
    return { value: `${y}-${String(m + 1).padStart(2, "0")}`, label: `${monthNames[m]} ${y}` };
  });
}
export const recapHref = (month: string) => `/api/director/tasks/recap?bulan=${month}`;

/** `7 Nov 2026 19.40 WIB`. */
const stamp = (iso: string) => `${new Intl.DateTimeFormat("id-ID", { timeZone: "Asia/Jakarta", day: "numeric", month: "short", year: "numeric" }).format(new Date(iso))} ${clockWib(iso)}`;

function Replies({ id, initial }: { id: string; initial?: StaffReply[] }) {
  const [state, setState] = useState<{ replies: StaffReply[] | null; error: string }>({ replies: initial ?? null, error: "" });
  useEffect(() => {
    if (initial) return;
    const controller = new AbortController();
    fetch(`/api/director/tasks/${encodeURIComponent(id)}/replies`, { cache: "no-store", signal: controller.signal })
      .then((response) => readJson<{ replies: StaffReply[] }>(response, "Balasan belum dapat dibaca."))
      .then(({ replies }) => setState({ replies, error: "" }))
      .catch((error: Error) => { if (!controller.signal.aborted) setState({ replies: null, error: error.message }); });
    return () => controller.abort();
  }, [id, initial]);
  if (state.error) return <p className="task-warn m-0">{state.error}</p>;
  if (!state.replies) return <p className="task-meta m-0"><LoadingState label="Memuat balasan" /></p>;
  if (!state.replies.length) return <p className="task-meta m-0">Belum ada balasan staf.</p>;
  return <ul className="task-history">{state.replies.map((reply) => <li key={reply.id}>
    <span className="task-meta">{reply.fromName} · {stamp(reply.receivedAt)}</span>
    <blockquote className="task-quote">{reply.originalText}</blockquote>
    {httpsAttachments(reply.attachments).length > 0 && <p className="task-photos m-0">{httpsAttachments(reply.attachments).map((file, index) => <a key={`${index}-${file.url}`} href={file.url} target="_blank" rel="noreferrer noopener" className="task-link">{`Foto ${index + 1}`}</a>)}</p>}
  </li>)}</ul>;
}

/** One archived task; expanding it shows the full status history and every staff reply. */
export function ArchiveRow({ row, replies }: { row: ArchiveRowData; replies?: StaffReply[] }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="task-archive-row">
      <details onToggle={(event) => setOpen((event.currentTarget as HTMLDetailsElement).open)}>
        <summary>
          <span className="task-archive-head"><span className="task-title">{row.itemTitle}</span><span className="task-meta">{row.id} · {row.reportDate} · {row.pic.join(", ") || "Grup default"} · {taskStatusLabels[row.status] ?? row.status}</span></span>
        </summary>
        <div className="task-archive-body">
          <p className="m-0">Arahan: {actionLabels[row.action as InstructionAction] ?? row.action}{row.note ? ` — ${row.note}` : ""}</p>
          <h3 className="task-subhead">Riwayat</h3>
          <ol className="task-history">{row.history.map((entry, index) => <li key={`${entry.at}-${index}`}><span className="task-meta">{stamp(entry.at)} · </span>{taskStatusLabels[entry.status] ?? entry.status}{entry.note ? ` · ${entry.note}` : ""}</li>)}</ol>
          <h3 className="task-subhead">Balasan staf</h3>
          {open || replies ? <Replies id={row.id} initial={replies} /> : null}
        </div>
      </details>
    </li>
  );
}

export function ArchiveView({ month }: { month: string }) {
  const [draft, setDraft] = useState<Filters>(empty), [filters, setFilters] = useState<Filters>(empty), [page, setPage] = useState(1), [recapMonth, setRecapMonth] = useState(month);
  const [state, setState] = useState<{ status: "loading" | "ready" | "error"; rows: ArchiveRowData[]; more: boolean; message: string }>({ status: "loading", rows: [], more: false, message: "" });

  useEffect(() => {
    const controller = new AbortController();
    const query = new URLSearchParams();
    for (const key of ["dari", "sampai", "q", "pic", "status"] as const) if (filters[key].trim()) query.set(key, filters[key].trim());
    if (filters.semua) query.set("semua", "1");
    query.set("halaman", String(page));
    fetch(`/api/director/tasks/archive?${query}`, { cache: "no-store", signal: controller.signal })
      .then((response) => readJson<{ rows: ArchiveRowData[]; adaLagi: boolean }>(response, "Arsip belum dapat dibaca."))
      .then((body) => setState({ status: "ready", rows: body.rows, more: body.adaLagi, message: "" }))
      .catch((error: Error) => { if (!controller.signal.aborted) setState({ status: "error", rows: [], more: false, message: error.message }); });
    return () => controller.abort();
  }, [filters, page]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState((current) => ({ ...current, status: "loading" }));
    setPage(1); setFilters({ ...draft });
  }
  const field = (key: "dari" | "sampai" | "q" | "pic") => (event: { target: { value: string } }) => setDraft({ ...draft, [key]: event.target.value });
  const go = (next: number) => { setState((current) => ({ ...current, status: "loading" })); setPage(next); };

  return (
    <div className="task-board">
      <form className="task-filters" onSubmit={submit} role="search">
        <label className="task-field task-field-wide">Cari<input type="search" value={draft.q} maxLength={120} placeholder="Perihal, nomor IOC, atau isi balasan" onChange={field("q")} /></label>
        <label className="task-field">Dari<input type="date" value={draft.dari} onChange={field("dari")} /></label>
        <label className="task-field">Sampai<input type="date" value={draft.sampai} onChange={field("sampai")} /></label>
        <label className="task-field">PIC<input value={draft.pic} maxLength={60} onChange={field("pic")} /></label>
        <label className="task-field">Status<select value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value })}>
          <option value="">Semua</option>
          {statusOptions.map((status) => <option key={status} value={status}>{taskStatusLabels[status]}</option>)}
        </select></label>
        <label className="task-check"><input type="checkbox" checked={draft.semua} onChange={(event) => setDraft({ ...draft, semua: event.target.checked })} />Termasuk tugas yang masih berjalan</label>
        <div className="task-buttons"><button type="submit" className="task-button task-button-primary">Tampilkan</button></div>
      </form>
      <div className="task-filters">
        <label className="task-field">Rekap bulan<select value={recapMonth} onChange={(event) => setRecapMonth(event.target.value)}>
          {recapMonths(month).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select></label>
        <div className="task-buttons"><a className="task-link" href={recapHref(recapMonth)}>Unduh rekap</a></div>
      </div>
      {state.status === "loading" ? <p className="director-notice"><LoadingState label="Memuat arsip" /></p>
        : state.status === "error" ? <p role="status" className="task-warn">{state.message}</p>
        : state.rows.length === 0 ? <p className="director-empty">Tidak ada tugas yang cocok.</p>
        : <ul className="task-archive">{state.rows.map((row) => <ArchiveRow key={row.id} row={row} />)}</ul>}
      {(page > 1 || state.more) && <div className="task-buttons">
        <button type="button" className="task-button" disabled={page <= 1 || state.status === "loading"} onClick={() => go(page - 1)}>Sebelumnya</button>
        <span className="task-meta">Halaman {page}</span>
        <button type="button" className="task-button" disabled={!state.more || state.status === "loading"} onClick={() => go(page + 1)}>Berikutnya</button>
      </div>}
      <div className="task-footer"><SourceInfo><p className="m-0 text-slate-700">Buku besar arahan di Supabase: riwayat status dan balasan staf dari Katt lewat Dash. Tugas selesai, ditunda, atau dibatalkan masuk arsip 7 hari setelah perubahan terakhir.</p></SourceInfo></div>
    </div>
  );
}
