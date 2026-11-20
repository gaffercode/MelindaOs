import type { Metadata } from "next";
import Link from "next/link";
import { DirectorShell } from "@/components/director/director-shell";
import { ArchiveView } from "@/components/tasks/archive-view";
import { wibDate } from "@/lib/director/director-data";
import { requireDirectorPage } from "@/lib/director/director-access";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Arsip Tugas | MelindaOS", description: "Arsip tugas dan arahan Direktur RSIA Melinda DHAI, lengkap dengan riwayat dan balasan staf.", robots: { index: false, follow: false } };

export default async function ArsipPage() {
  const today = wibDate();
  const authenticated = await requireDirectorPage("/arahan/arsip");
  return (
    <DirectorShell date={today} pending={null} authenticated={authenticated} followLatest activeSection="arahan">
      <div className="page-content director-page report-page">
        <header className="page-heading"><div><span className="director-eyebrow">RSIA Melinda DHAI · Laporan eksekutif</span><h1>Arsip tugas</h1><p className="m-0 text-slate-600">Tugas yang sudah selesai, ditunda, atau dibatalkan. Buka satu baris untuk melihat riwayat dan balasan staf.</p></div>
          <Link href="/arahan" prefetch={false} className="task-link">Kembali ke arahan</Link>
        </header>
        {authenticated ? <ArchiveView month={today.slice(0, 7)} /> : <p role="status" className="director-notice">Arsip tugas membaca buku besar di Supabase, jadi hanya tersedia dalam mode terlindung.</p>}
      </div>
    </DirectorShell>
  );
}
