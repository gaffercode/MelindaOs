import { CountLink } from "./count-link";
import { clockWib, taskStatusLabels, type BoardSummaryCounts, type BoardTask, type TaskFilter } from "./board-client";

/** `N tugas terbuka · N terlambat · N ada kendala`, plus `N tanpa balasan` when any task ran out of reminders; each count links to the filtered list.
 * After an action the board is read again and each count that changed counts to its new value (CountLink), with a brief highlight. */
export function BoardSummary({ summary, active }: { summary: BoardSummaryCounts; active: TaskFilter | null }) {
  const parts: { filter: TaskFilter; count: number; label: string; warn?: boolean }[] = [
    { filter: "terbuka", count: summary.open, label: " tugas terbuka" },
    { filter: "terlambat", count: summary.overdue, label: " terlambat", warn: summary.overdue > 0 },
    { filter: "kendala", count: summary.kendala, label: " ada kendala", warn: summary.kendala > 0 },
    ...(summary.escalated > 0 ? [{ filter: "tanpa_balasan" as const, count: summary.escalated, label: " tanpa balasan", warn: true }] : []),
  ];
  return (
    <p className="task-summary">
      {parts.map((part, index) => <span key={part.filter}>
        {index > 0 && <span className="task-summary-sep" aria-hidden="true"> · </span>}
        <CountLink href={active === part.filter ? "/arahan" : `/arahan?tugas=${part.filter}`} current={active === part.filter} className={part.warn ? "task-link task-warn" : "task-link"} value={part.count} suffix={part.label} />
      </span>)}
    </p>
  );
}

/** Latest status of a task and when it changed; overdue adds a plain red-orange `Terlambat`. */
export function TaskStatusChip({ task, id }: { task?: BoardTask; id: string }) {
  if (!task) return <span className="task-chip">{id}</span>;
  const last = task.history.at(-1)?.at ?? task.createdAt;
  return (
    <span className="task-chip" data-state={task.status}>
      {task.id} · {taskStatusLabels[task.status] ?? task.status} · {clockWib(last)}
      {task.overdue && <span className="task-warn"> · Terlambat</span>}
      {task.reminder === "escalated" && <span className="task-warn"> · Belum dibalas setelah 2 pengingat</span>}
    </span>
  );
}
