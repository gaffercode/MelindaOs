"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { fetchMarks, missingOnServer, saveMarks } from "../marks-client";
import { SourceInfo } from "../source-info";
import { clockWib, filterTasks, hiddenReplies, newestLinked, readJson, type BoardData, type TaskFilter } from "./board-client";
import { LoadingState } from "../loading-state";
import { sessionResponse } from "@/lib/client-api";
import { wibDate } from "@/lib/director/director-data";
import { GlideList } from "../glide-list";
import { ExecutiveSyncBar } from "../work-schedule/executive-sync-bar";
import { BoardSummary, TaskStatusChip } from "./board-summary";
import { KendalaCard, PerluDibacaCard } from "./kendala-card";
import { TodaySchedule } from "./today-schedule";

const filterTitles: Record<TaskFilter, string> = { terbuka: "Tugas terbuka", terlambat: "Tugas terlambat", kendala: "Tugas ada kendala", tanpa_balasan: "Tugas tanpa balasan" };

/**
 * Top of /arahan: summary, today's schedule and the cards that need the Director.
 * Reads the board once on mount and again after every successful action (no optimistic updates).
 */
export function TaskBoard({ filter }: { filter: TaskFilter | null }) {
  const [state, setState] = useState<{ status: "loading" | "ready" | "error"; message: string; data: BoardData | null; csrf: string; readAt: string }>({ status: "loading", message: "", data: null, csrf: "", readAt: "" });
  // A reply is hidden when its id is in the browser set or in the server set. The browser copy is a cache and a fallback: it hides at once
  // and still works when the server cannot be read. The server render shows "Memuat…" either way, so there is no hydration mismatch.
  const [hidden, setHidden] = useState<Set<string>>(() => hiddenReplies.read());
  const [serverRead, setServerRead] = useState<Set<string>>(() => new Set());
  // Browser-only ids already sent in this page's lifetime, so a reload that overlaps an upload does not send them twice.
  const uploaded = useRef(new Set<string>());

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const [session, data, marks] = await Promise.all([
        sessionResponse(signal).then((response) => readJson<{ csrfToken: string }>(response)),
        fetch("/api/director/tasks/board", { cache: "no-store", signal }).then((response) => readJson<BoardData>(response, "Papan tugas belum dapat dibaca.")),
        // A failed marks read is not a board failure: it means "no server data" and the browser set is used alone.
        fetchMarks("task_reply_read", { signal }).catch(() => null),
      ]);
      if (signal?.aborted) return;
      setState({ status: "ready", message: "", data, csrf: session.csrfToken, readAt: new Date().toISOString() });
      if (marks) {
        setServerRead(new Set(marks.map((mark) => mark.key)));
        // Marks made before the server kept them, and marks whose save failed earlier, go up once the read has worked.
        const browserOnly = missingOnServer([...hiddenReplies.read()].map((key) => ({ key, value: "read" })), marks).filter((mark) => !uploaded.current.has(mark.key));
        if (session.csrfToken && browserOnly.length > 0) {
          for (const mark of browserOnly) uploaded.current.add(mark.key);
          saveMarks("task_reply_read", browserOnly, session.csrfToken).catch(() => { for (const mark of browserOnly) uploaded.current.delete(mark.key); });
        }
      }
    } catch (error) {
      if (!signal?.aborted) setState((current) => ({ ...current, status: current.data ? "ready" : "error", message: (error as Error).message }));
    }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const refresh = () => { void load(); };
  const hide = (id: string) => {
    hiddenReplies.add(id); setHidden(hiddenReplies.read());
    saveMarks("task_reply_read", [{ key: id, value: "read" }], state.csrf).catch(() => {});
  };

  if (state.status === "loading") return <p className="director-notice"><LoadingState label="Memuat papan tugas" /></p>;
  if (state.status === "error" || !state.data) return <p role="status" className="director-notice director-error">{state.message || "Papan tugas belum dapat dibaca."} Muat ulang halaman.</p>;
  const { data, csrf } = state;
  const kendala = data.tasks.filter((task) => task.status === "terkendala");
  const toRead = data.tasks.filter((task) => task.status !== "terkendala" && task.latestReply?.classifiedStatus === "perlu_dibaca" && !hidden.has(task.latestReply.id) && !serverRead.has(task.latestReply.id) && !["selesai", "ditunda", "dibatalkan"].includes(task.status));
  const filtered = filter ? filterTasks(data.tasks, filter) : [];

  return (
    <div className="task-board">
      <ExecutiveSyncBar date={wibDate()} label="Sinkronkan jadwal & tugas hari ini" onSynced={refresh} />
      <BoardSummary summary={data.summary} active={filter} />
      {state.message && <p className="task-warn m-0" role="alert">{state.message}</p>}
      {filter && <section className="task-section" aria-labelledby="tugas-filter">
        <div className="task-section-head"><h2 id="tugas-filter" className="swiss-section-heading">{filterTitles[filter]}</h2><Link href="/arahan" prefetch={false} className="task-link">Tutup</Link></div>
        {filtered.length === 0 ? <p className="director-empty">Tidak ada.</p> : <ul className="task-list">{filtered.map((task) => <li key={task.id}><span className="task-title">{task.itemTitle}</span><span className="task-meta">{task.pic.join(", ") || "Grup default"}</span><TaskStatusChip id={task.id} task={task} /></li>)}</ul>}
      </section>}
      <TodaySchedule items={data.schedule} tasks={data.tasks} csrf={csrf} onDone={refresh} />
      {(kendala.length > 0 || toRead.length > 0) && <section className="task-section" aria-labelledby="perlu-direktur">
        <h2 id="perlu-direktur" className="swiss-section-heading">Perlu keputusan Direktur</h2>
        <div className="task-cards">
          {/* A card the Director has dealt with fades out and the cards after it glide up into the gap. */}
          <GlideList>
            {kendala.map((task) => <div key={task.id}><KendalaCard task={task} linked={newestLinked(data.tasks, task.id)} csrf={csrf} onDone={refresh} /></div>)}
            {toRead.map((task) => <div key={task.id}><PerluDibacaCard task={task} csrf={csrf} onDone={refresh} onHide={hide} /></div>)}
          </GlideList>
        </div>
      </section>}
      <div className="task-footer">
        <Link href="/arahan/persiapan" prefetch={false} className="task-link">Persiapan rapat</Link>
        <Link href="/arahan/arsip" prefetch={false} className="task-link">Arsip tugas</Link>
        <SourceInfo><p className="m-0 text-slate-700">Jadwal dari Dash, balasan staf dari Katt lewat Dash, status dari buku besar arahan di Supabase. Dibaca {clockWib(state.readAt)}.</p></SourceInfo>
      </div>
    </div>
  );
}
