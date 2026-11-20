"use client";

import { useRef, useState, type FormEvent } from "react";
import { latestHistoryNote } from "@/lib/director/director-instructions";
import type { StaffReply } from "@/lib/tasks/store";
import { Expand } from "../motion";
import { taskStatusLabels, clockWib, decisionBody, httpsAttachments, postJson, type BoardTask, type QuickKind } from "./board-client";

/** Validates, then posts one Director decision; a validation failure throws before anything is sent. */
export async function sendDecision(id: string, kind: QuickKind, note: string, picText: string, csrf: string) {
  const result = decisionBody(kind, note, picText);
  if ("error" in result) throw new Error(result.error);
  return postJson<unknown>(`/api/director/tasks/${encodeURIComponent(id)}/decision`, result.body, csrf);
}

function useDecision(id: string, csrf: string, onDone: () => void) {
  const [busy, setBusy] = useState<QuickKind | null>(null), [error, setError] = useState("");
  // Set synchronously, before the first await, so a second tap in the same frame is ignored even before `busy` re-renders.
  const inFlight = useRef(false);
  async function decide(kind: QuickKind, note = "", picText = ""): Promise<boolean> {
    if (inFlight.current) return false;
    inFlight.current = true;
    setBusy(kind); setError("");
    try { await sendDecision(id, kind, note, picText, csrf); onDone(); return true; } catch (cause) { setError((cause as Error).message); return false; } finally { inFlight.current = false; setBusy(null); }
  }
  return { busy, error, decide };
}

function Original({ reply }: { reply: StaffReply }) {
  return (
    <details className="task-original">
      <summary className="task-link">Lihat pesan asli</summary>
      <blockquote className="task-quote">{reply.originalText}</blockquote>
      <p className="task-meta m-0">{reply.fromName} · {clockWib(reply.receivedAt)}</p>
    </details>
  );
}

function Photos({ reply }: { reply: StaffReply }) {
  const files = httpsAttachments(reply.attachments);
  if (!files.length) return null;
  return <p className="task-photos m-0">{files.map((file, index) => <a key={`${index}-${file.url}`} href={file.url} target="_blank" rel="noreferrer noopener" className="task-link">{`Foto ${index + 1}`}</a>)}</p>;
}

const quickLabels: Record<"putuskan" | "alihkan" | "tunda" | "hubungi_saya", string> = { putuskan: "Putuskan", alihkan: "Alihkan", tunda: "Tunda", hubungi_saya: "Hubungi saya" };

/** `linked`: the newest task already created from a decision on this card; while it exists a second decision is not offered. */
export function KendalaCard({ task, linked, csrf, onDone }: { task: BoardTask; linked?: BoardTask; csrf: string; onDone: () => void }) {
  const { busy, error, decide } = useDecision(task.id, csrf, onDone);
  const [form, setForm] = useState<"putuskan" | "alihkan" | null>(null), [text, setText] = useState(""), [localError, setLocalError] = useState("");
  const reply = task.latestReply;
  const summary = reply?.summary ?? latestHistoryNote(task.history) ?? "Staf melaporkan kendala.";

  function toggle(kind: "putuskan" | "alihkan") { setForm(form === kind ? null : kind); setText(""); setLocalError(""); }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form) return;
    const check = form === "putuskan" ? decisionBody(form, text, "") : decisionBody(form, "", text);
    if ("error" in check) { setLocalError(check.error); return; }
    setLocalError("");
    if (await (form === "putuskan" ? decide(form, text) : decide(form, "", text))) { setForm(null); setText(""); }
  }

  return (
    <article className="task-card" aria-labelledby={`kendala-${task.id}`}>
      <p className="task-meta m-0">{task.id} · {task.pic.join(", ") || "Grup default"}{task.overdue && <span className="task-warn"> · Terlambat</span>}</p>
      <h3 id={`kendala-${task.id}`} className="task-card-title">{task.itemTitle}</h3>
      <p className="task-warn m-0">{summary}</p>
      {reply?.needs && <p className="m-0">Yang dibutuhkan: {reply.needs}</p>}
      {reply && <Original reply={reply} />}
      {reply && <Photos reply={reply} />}
      {linked && <p className="m-0">Keputusan dikirim: {linked.id} · {taskStatusLabels[linked.status] ?? linked.status}</p>}
      {/* One block for the buttons and the form they open: as a grid item of its own the form would add the card's gap the instant it mounts. */}
      <div>
        <div className="task-buttons">
          {!linked && <button type="button" className="task-button" aria-expanded={form === "putuskan"} disabled={busy !== null} onClick={() => toggle("putuskan")}>{quickLabels.putuskan}</button>}
          {!linked && <button type="button" className="task-button" aria-expanded={form === "alihkan"} disabled={busy !== null} onClick={() => toggle("alihkan")}>{quickLabels.alihkan}</button>}
          <button type="button" className="task-button" disabled={busy !== null} onClick={() => void decide("tunda")}>{busy === "tunda" ? "Mengirim…" : quickLabels.tunda}</button>
          {!linked && <button type="button" className="task-button" disabled={busy !== null} onClick={() => void decide("hubungi_saya")}>{busy === "hubungi_saya" ? "Mengirim…" : quickLabels.hubungi_saya}</button>}
          <button type="button" className="task-button" disabled={busy !== null} onClick={() => void decide("selesai")}>{busy === "selesai" ? "Mengirim…" : "Tandai selesai"}</button>
        </div>
        <Expand open={form !== null && !linked}>{form && <form className="task-inline-form" onSubmit={(event) => void submit(event)} noValidate>
          <label className="sr-only" htmlFor={`${form}-${task.id}`}>{form === "putuskan" ? "Keputusan" : "PIC baru, pisahkan dengan koma"}</label>
          <input id={`${form}-${task.id}`} value={text} maxLength={form === "putuskan" ? 280 : 500} placeholder={form === "putuskan" ? "Keputusan Direktur, satu kalimat." : "PIC baru, pisahkan dengan koma"} onChange={(event) => setText(event.target.value)} />
          <button type="submit" className="task-button task-button-primary" disabled={busy !== null}>{busy === form ? "Mengirim…" : "Kirim"}</button>
        </form>}</Expand>
      </div>
      {(localError || error) && <p className="task-warn m-0" role="alert">{localError || error}</p>}
    </article>
  );
}

/** A reply Katt labelled `perlu_dibaca`: verbatim text; "Sudah dibaca" only hides it here, "Tandai selesai" closes the task. */
export function PerluDibacaCard({ task, csrf, onDone, onHide }: { task: BoardTask; csrf: string; onDone: () => void; onHide: (replyId: string) => void }) {
  const { busy, error, decide } = useDecision(task.id, csrf, onDone);
  const reply = task.latestReply;
  if (!reply) return null;
  return (
    <article className="task-card" aria-labelledby={`dibaca-${reply.id}`}>
      <p className="task-meta m-0">{task.id} · {reply.fromName} · {clockWib(reply.receivedAt)}</p>
      <h3 id={`dibaca-${reply.id}`} className="task-card-title">Perlu dibaca · {task.itemTitle}</h3>
      <blockquote className="task-quote">{reply.originalText}</blockquote>
      <Photos reply={reply} />
      <div className="task-buttons">
        <button type="button" className="task-button" disabled={busy !== null} onClick={() => onHide(reply.id)}>Sudah dibaca</button>
        <button type="button" className="task-button" disabled={busy !== null} onClick={() => void decide("selesai")}>{busy === "selesai" ? "Mengirim…" : "Tandai selesai"}</button>
      </div>
      {error && <p className="task-warn m-0" role="alert">{error}</p>}
    </article>
  );
}
