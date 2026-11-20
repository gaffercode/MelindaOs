"use client";

import { useState } from "react";
import { sessionResponse } from "@/lib/client-api";

export function ExecutiveSyncBar({
  date,
  label = "Sinkronkan hari ini",
  onSynced,
}: {
  date: string;
  label?: string;
  onSynced?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string>("");

  const handleSync = async () => {
    setBusy(true);
    setNotice("");
    try {
      const sessionRes = await sessionResponse();
      const session = (await sessionRes.json().catch(() => ({}))) as { csrfToken?: string };
      const res = await fetch("/api/director/tasks/sync-today", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(session.csrfToken ? { "X-CSRF-Token": session.csrfToken } : {}),
        },
        body: JSON.stringify({ date }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error || "Sinkronisasi gagal.");
      }
      const data = (await res.json()) as {
        scheduleCount: number;
        openTasksCount: number;
        thirdPartyCount: number;
      };
      setNotice(
        `Tersinkron: ${data.scheduleCount} slot jadwal, ${data.openTasksCount} tugas aktif (${data.thirdPartyCount} pihak ke-3).`
      );
      if (onSynced) {
        onSynced();
      } else if (typeof window !== "undefined") {
        window.location.reload();
      }
    } catch (error) {
      setNotice((error as Error).message || "Gagal menyinkronkan.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        onClick={() => void handleSync()}
        disabled={busy}
        className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-900 shadow-xs hover:bg-slate-50 disabled:opacity-60"
      >
        {busy ? "Menyinkronkan…" : label}
      </button>
      {notice ? (
        <span role="status" className="text-sm text-slate-600">
          {notice}
        </span>
      ) : null}
    </div>
  );
}
