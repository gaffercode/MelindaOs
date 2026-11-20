import type { Metadata } from "next";
import { Suspense } from "react";
import { DirectorShell } from "@/components/director/director-shell";
import { LoadingState } from "@/components/loading-state";
import { DirectorInstructionRegister, registerDays } from "@/components/director/director-instruction-register";
import { taskFilters, type TaskFilter } from "@/components/tasks/board-client";
import { TaskBoard } from "@/components/tasks/task-board";
import { wibDate } from "@/lib/director/director-data";
import { requireDirectorPage } from "@/lib/director/director-access";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Arahan Direktur | MelindaOS", description: "Semua arahan Direktur RSIA Melinda DHAI yang belum selesai, dengan status terkini dari staff.", robots: { index: false, follow: false } };

const WINDOWS = [7, 14, 31] as const;

export default async function ArahanPage({ searchParams }: { searchParams: Promise<{ hari?: string | string[]; tugas?: string | string[] }> }) {
  const today = wibDate();
  const { hari, tugas } = await searchParams;
  const days = registerDays(hari);
  const filter = typeof tugas === "string" && (taskFilters as readonly string[]).includes(tugas) ? tugas as TaskFilter : null;
  const query = new URLSearchParams({ ...(hari === undefined ? {} : { hari: String(days) }), ...(filter ? { tugas: filter } : {}) }).toString();
  const authenticated = await requireDirectorPage(query ? `/arahan?${query}` : "/arahan");
  return (
    <DirectorShell date={today} pending={null} authenticated={authenticated} followLatest activeSection="arahan">
      <div className="page-content director-page report-page">
        <header className="page-heading"><div><span className="director-eyebrow">RSIA Melinda DHAI · Laporan eksekutif</span><h1>Arahan Direktur</h1><p className="m-0 text-slate-600">Yang masih ditunggu dari staff, dan arahan baru di luar brief.</p></div>
          <form method="get" action="/arahan" className="director-date-form"><label htmlFor="register-days">Jendela</label><div><select id="register-days" name="hari" defaultValue={String(days)}>{WINDOWS.map((window) => <option key={window} value={window}>{window} hari</option>)}</select><button className="director-button" type="submit">Tampilkan</button></div></form>
        </header>
        {authenticated && <TaskBoard filter={filter} />}
        <Suspense fallback={<p className="director-notice"><LoadingState label="Memuat arahan" /></p>}>
          <DirectorInstructionRegister today={today} days={days} />
        </Suspense>
      </div>
    </DirectorShell>
  );
}
