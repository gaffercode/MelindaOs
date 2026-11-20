"use client";

import { useState } from "react";
import { sessionResponse } from "@/lib/client-api";
import {
  STRUCTURAL_ROLES,
  buildBaselineSchedule,
  leadBriefRotation,
  type StructuralRoleId,
} from "@/lib/work-schedule/baseline-schedule";
import {
  injectTasksIntoSchedule,
  resolveVaultTasks,
  type VaultTaskStatus,
} from "@/lib/work-schedule/task-vault";

const STATUS_BADGE_LABELS: Record<VaultTaskStatus, string> = {
  selesai: "Selesai",
  berjalan: "Berjalan",
  pending_pihak_ketiga: "Pending pihak ke-3",
  butuh_keputusan_direktur: "Butuh keputusan Direktur",
  menunggu_verifikasi_novia: "Menunggu verifikasi dr. Novia",
};

export function RoleSchedulePanel({ date }: { date: string }) {
  const [roleId, setRoleId] = useState<StructuralRoleId>("direktur");
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);
  const [localStatuses, setLocalStatuses] = useState<Record<string, VaultTaskStatus>>({});
  const [feedbackMessage, setFeedbackMessage] = useState<string>("");

  const rotation = leadBriefRotation(date);
  const resolvedTasks = resolveVaultTasks([]).map((t) => ({
    ...t,
    status: localStatuses[t.id] ?? t.status,
  }));
  const slots = injectTasksIntoSchedule(buildBaselineSchedule(date, roleId), resolvedTasks);

  const sendFeedback = async (
    taskId: string,
    status: VaultTaskStatus,
    scheduleSlotId: string
  ) => {
    setBusyTaskId(taskId);
    setFeedbackMessage("");
    try {
      const sessionRes = await sessionResponse();
      const session = (await sessionRes.json().catch(() => ({}))) as { csrfToken?: string };
      const res = await fetch("/api/director/tasks/vault-feedback", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(session.csrfToken ? { "X-CSRF-Token": session.csrfToken } : {}),
        },
        body: JSON.stringify({
          date,
          taskId,
          status,
          scheduleSlotId,
        }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error || "Gagal menyimpan status tugas.");
      }
      const data = (await res.json()) as {
        resolvedStatus: VaultTaskStatus;
        rule39Applied: boolean;
      };
      setLocalStatuses((prev) => ({ ...prev, [taskId]: data.resolvedStatus }));
      setFeedbackMessage(
        data.rule39Applied
          ? `${taskId}: Dicatat sebagai menunggu verifikasi dr. Novia (Rule #39).`
          : `${taskId}: Status diperbarui menjadi ${STATUS_BADGE_LABELS[data.resolvedStatus]}.`
      );
    } catch (error) {
      setFeedbackMessage((error as Error).message || "Gagal memperbarui status.");
    } finally {
      setBusyTaskId(null);
    }
  };

  return (
    <div className="mt-4 space-y-4 rounded-xl border border-slate-200 bg-slate-50/70 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="m-0 text-sm font-medium text-slate-900">
            Jadwal struktural 8 jabatan · Pekan {rotation.weekIndex} (Pemimpin Lead Brief: {rotation.leaderName})
          </p>
          <p className="m-0 text-xs text-slate-600">
            Pilih jabatan untuk melihat jam kerja dan bahan Task Vault yang disuntikkan otomatis ke tiap rapat.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Pilih jabatan struktural">
        {STRUCTURAL_ROLES.map((role) => {
          const active = role.id === roleId;
          return (
            <button
              key={role.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setRoleId(role.id)}
              className={
                active
                  ? "rounded-lg border border-slate-900 bg-slate-900 px-2.5 py-1 text-xs font-medium text-white"
                  : "rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
              }
            >
              {role.title}
            </button>
          );
        })}
      </div>

      {feedbackMessage ? (
        <p role="status" className="m-0 text-sm font-medium text-slate-800">
          {feedbackMessage}
        </p>
      ) : null}

      <div className="space-y-2">
        {slots.map((slot) => (
          <div
            key={slot.id}
            className="rounded-lg border border-slate-200 bg-white p-3"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="m-0 text-sm font-medium text-slate-900">
                <span className="mr-2 font-mono text-xs text-slate-500">{slot.timeRange}</span>
                {slot.title}
              </p>
              <span className="text-xs text-slate-500">{slot.participants.join(", ")}</span>
            </div>
            <p className="mt-1 mb-0 text-xs text-slate-600">{slot.baselineAgenda}</p>

            {slot.injectedTasks.length > 0 ? (
              <ul className="mt-2 space-y-1.5 border-t border-slate-100 pt-2">
                {slot.injectedTasks.map((task) => (
                  <li
                    key={task.id}
                    className="flex flex-wrap items-center justify-between gap-2 text-xs"
                  >
                    <span className="text-slate-800">
                      <strong className="font-medium">{task.id}</strong> · {task.title}{" "}
                      <span className="text-slate-500">
                        ({STATUS_BADGE_LABELS[task.status]}
                        {task.thirdPartyName ? ` · ${task.thirdPartyName}` : ""})
                      </span>
                    </span>
                    <span className="flex flex-wrap gap-1">
                      <button
                        type="button"
                        disabled={busyTaskId === task.id}
                        onClick={() => void sendFeedback(task.id, "selesai", slot.id)}
                        className="rounded border border-slate-300 bg-white px-2 py-0.5 text-xs text-slate-800 hover:bg-slate-100 disabled:opacity-50"
                      >
                        Selesai
                      </button>
                      <button
                        type="button"
                        disabled={busyTaskId === task.id}
                        onClick={() => void sendFeedback(task.id, "berjalan", slot.id)}
                        className="rounded border border-slate-300 bg-white px-2 py-0.5 text-xs text-slate-800 hover:bg-slate-100 disabled:opacity-50"
                      >
                        Pending
                      </button>
                      <button
                        type="button"
                        disabled={busyTaskId === task.id}
                        onClick={() =>
                          void sendFeedback(task.id, "pending_pihak_ketiga", slot.id)
                        }
                        className="rounded border border-slate-300 bg-white px-2 py-0.5 text-xs text-slate-800 hover:bg-slate-100 disabled:opacity-50"
                      >
                        Pihak ke-3
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
