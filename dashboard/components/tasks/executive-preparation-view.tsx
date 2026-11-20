"use client";

import { useEffect, useState } from "react";
import type { ReadinessItem } from "@/lib/executive/executive-office";

type Check = { item: ReadinessItem; label: string; state: "pending" | "ready" | "blocked"; evidence: string | null };
type Meeting = {
  meetingId: string; title: string; startAt: string; endAt: string; department: string | null;
  synchronized: boolean; conflict: boolean; sharedWithNovia: boolean;
  readiness: "ready" | "partial" | "blocked"; checklist: Check[];
};
type PreparationPlan = {
  date: string; meetings: Meeting[];
  outbox: { key: string; meetingId: string; kind: string; state: string; recordedAt: string | null }[];
  archives: { meetingId: string; archivedAt: string; minutesUrl: string | null }[];
};
const time = (value: string) => new Intl.DateTimeFormat("id-ID", {
  timeZone: "Asia/Jakarta", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
}).format(new Date(value));

export function ExecutivePreparationView({ today }: { today: string }) {
  const [date, setDate] = useState(today);
  const [data, setData] = useState<PreparationPlan | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const read = async () => {
      try {
        const response = await fetch(`/api/director/executive/plan?date=${encodeURIComponent(date)}`, { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error(response.status === 401 ? "Sesi Direktur berakhir. Masuk kembali." : "Data persiapan rapat belum tersedia.");
        const plan = await response.json() as PreparationPlan;
        if (!controller.signal.aborted) { setData(plan); setStatus("ready"); setError(""); }
      } catch (caught) {
        if (!controller.signal.aborted) { setError((caught as Error).message); setStatus("error"); }
      }
    };
    void read();
    return () => controller.abort();
  }, [date, refresh]);
  const state = (value: string) => ({
    ready: "Siap", partial: "Perlu dilengkapi", blocked: "Terhambat",
    pending: "Belum dikonfirmasi", sent: "Terkirim", failed: "Gagal", superseded: "Diganti jadwal baru",
  }[value] ?? value);
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <label className="flex flex-col gap-2 text-sm text-slate-700">
          Tanggal agenda
          <input aria-label="Tanggal agenda" className="rounded-md border border-slate-300 bg-white px-3 py-2 text-base"
            type="date" value={date} onChange={(event) => { setStatus("loading"); setDate(event.currentTarget.value); }} />
        </label>
        <button className="director-button" type="button" onClick={() => { setStatus("loading"); setRefresh((value) => value + 1); }}>Muat ulang</button>
      </div>
      {status === "loading" && <p role="status" className="director-notice">Memeriksa kesiapan rapat…</p>}
      {status === "error" && <p role="alert" className="director-notice director-error">{error}</p>}
      {status === "ready" && data && (data.meetings.length === 0
        ? <p role="status" className="director-notice">Belum ada agenda rapat dari sinkronisasi kalender untuk tanggal ini. Ini bukan bukti jadwal kosong; periksa koneksi kalender Alfred.</p>
        : <div className="space-y-4">
          {data.meetings.map((meeting) => {
            const notices = data.outbox.filter((row) => row.meetingId === meeting.meetingId);
            const archive = data.archives.filter((row) => row.meetingId === meeting.meetingId);
            return (
              <section key={meeting.meetingId} className="swiss-section rounded-lg border border-slate-200 bg-white p-4" aria-label={meeting.title}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="m-0 text-sm text-slate-600">{time(meeting.startAt)}–{time(meeting.endAt)} WIB{meeting.department ? ` · ${meeting.department}` : ""}</p>
                    <h2 className="mt-1 text-xl font-semibold text-slate-900">{meeting.title}</h2>
                  </div>
                  <span className="text-sm font-medium text-slate-700">{state(meeting.readiness)}</span>
                </div>
                <p className="mt-2 text-sm text-slate-600">
                  {meeting.sharedWithNovia ? meeting.conflict ? "Konflik dengan agenda dr. Novia — jadwal perlu diselesaikan." :
                    meeting.synchronized ? "Jadwal bersama telah cocok pada kedua kalender." :
                    "Menunggu konfirmasi dari kalender dr. Novia." : "Agenda Direktur."}
                </p>
                <h3 className="mt-4 font-medium">Persiapan Asisten Direktur</h3>
                <ul className="mt-2 divide-y divide-slate-100">
                  {meeting.checklist.map((check) => (
                    <li key={check.item} className="flex flex-wrap items-start justify-between gap-3 py-2 text-sm">
                      <span>{check.label}{check.evidence ? <span className="block text-slate-600">{check.evidence}</span> : null}</span>
                      <span className="text-slate-600">{state(check.state)}</span>
                    </li>
                  ))}
                </ul>
                <h3 className="mt-4 font-medium">Koordinasi Katt</h3>
                {notices.length === 0 ? <p className="mt-1 text-sm text-slate-600">Belum ada receipt pengiriman.</p>
                  : <ul className="mt-2 space-y-1 text-sm text-slate-600">
                    {notices.map((notice) => <li key={notice.key}>{notice.kind === "assistant_brief" ? "Briefing asisten" :
                      notice.kind === "department_invitation" ? "Undangan departemen" : "Pemeriksaan kesiapan"}: {state(notice.state)}</li>)}
                  </ul>}
                {archive.length ? <p className="mt-4 text-sm text-slate-600">Notulen/hasil telah diarsipkan ({archive.length} receipt).</p>
                  : <p className="mt-4 text-sm text-slate-600">Hasil rapat belum diarsipkan.</p>}
              </section>
            );
          })}
        </div>)}
    </div>
  );
}
