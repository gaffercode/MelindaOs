"use client";

import { useRef, useState, type FormEvent } from "react";
import type { Instruction } from "@/lib/director/director-instructions";
import type { ScheduleRow } from "@/lib/tasks/store";
import { dotTime, newKey, postJson, scheduleInstruction, type BoardTask } from "./board-client";
import { TaskStatusChip } from "./board-summary";
import { Expand } from "../motion";
import { toast } from "@/components/ui/toast";

type RowAction = "approve" | "defer" | "assign";

/** Creates the instruction for one schedule-row button through the existing "Beri arahan" endpoint. */
export function sendScheduleAction(item: ScheduleRow, action: RowAction, note: string, csrf: string, key: string) {
  return postJson<{ instruction: Instruction }>("/api/director/instructions", scheduleInstruction(item, action, note), csrf, key);
}

function ScheduleItem({ item, tasks, csrf, onDone }: { item: ScheduleRow; tasks: BoardTask[]; csrf: string; onDone: () => void }) {
  const [busy, setBusy] = useState<RowAction | null>(null), [error, setError] = useState(""), [open, setOpen] = useState(false), [note, setNote] = useState("");
  // One key per distinct request, so a retry after a network error replays instead of duplicating.
  const operation = useRef<{ signature: string; key: string } | null>(null), inFlight = useRef(false);
  const newestId = item.taskIds.at(-1);
  const noPic = item.pic.length === 0;

  async function run(action: RowAction, text = "") {
    // Set synchronously, before the first await, so a double tap posts once even before `busy` re-renders.
    if (inFlight.current) return;
    inFlight.current = true;
    const signature = JSON.stringify([action, text.trim()]);
    if (operation.current?.signature !== signature) operation.current = { signature, key: newKey() };
    setBusy(action); setError("");
    try {
      await sendScheduleAction(item, action, text, csrf, operation.current.key);
      operation.current = null; setOpen(false); setNote("");
      toast.success(action === "approve" ? "Disetujui" : action === "defer" ? "Ditunda" : "Arahan dikirim", { description: item.title });
      onDone();
    } catch (cause) { setError((cause as Error).message); } finally { inFlight.current = false; setBusy(null); }
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (note.trim()) void run("assign", note);
  }

  const time = item.end ? `${dotTime(item.start)}–${dotTime(item.end)}` : dotTime(item.start);
  return (
    <li className="task-schedule-row">
      <div className="task-schedule-main">
        <span className="task-time">{time}</span>
        <div className="task-schedule-text">
          <span className="task-title">{item.title}</span>
          <span className="task-meta">{[item.place, item.pic.length ? item.pic.join(", ") : null].filter(Boolean).join(" · ") || "Tempat dan PIC belum diisi"}</span>
        </div>
      </div>
      {newestId ? <TaskStatusChip id={newestId} task={tasks.find((task) => task.id === newestId)} /> : <div className="task-actions">
        {/* One block for the buttons and the form they open: as a grid item of its own the form would add the card's gap the instant it mounts. */}
        <div>
          <div className="task-buttons">
            <button type="button" className="task-button" disabled={busy !== null || !csrf} onClick={() => void run("approve")}>{busy === "approve" ? "Mengirim…" : "Setuju"}</button>
            <button type="button" className="task-button" disabled={busy !== null || !csrf} onClick={() => void run("defer")}>{busy === "defer" ? "Mengirim…" : "Tolak / tunda"}</button>
            <button type="button" className="task-button" disabled={busy !== null || !csrf || noPic} aria-expanded={open} onClick={() => setOpen(!open)}>Arahan</button>
          </div>
          <Expand open={open}><form className="task-inline-form" onSubmit={submit}>
            <label className="sr-only" htmlFor={`arahan-${item.id}`}>Arahan untuk {item.title}</label>
            <input id={`arahan-${item.id}`} value={note} maxLength={280} placeholder="Satu kalimat. Jangan tulis data pasien." onChange={(event) => setNote(event.target.value)} />
            <button type="submit" className="task-button task-button-primary" disabled={busy !== null || !note.trim()}>{busy === "assign" ? "Mengirim…" : "Kirim"}</button>
          </form></Expand>
        </div>
        {noPic && <p className="task-hint">PIC belum diisi Dash</p>}
        {error && <p className="task-warn m-0" role="alert">{error}</p>}
      </div>}
    </li>
  );
}

export function TodaySchedule({ items, tasks, csrf, onDone }: { items: ScheduleRow[]; tasks: BoardTask[]; csrf: string; onDone: () => void }) {
  return (
    <section className="task-section" aria-labelledby="jadwal-hari-ini">
      <h2 id="jadwal-hari-ini" className="swiss-section-heading">Jadwal hari ini</h2>
      {items.length === 0 ? <p className="director-empty">Jadwal hari ini belum dikirim Dash.</p>
        : <ul className="task-schedule">{items.map((item) => <ScheduleItem key={item.id} item={item} tasks={tasks} csrf={csrf} onDone={onDone} />)}</ul>}
    </section>
  );
}
