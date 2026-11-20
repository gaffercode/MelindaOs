import type { Metadata } from "next";
import Link from "next/link";
import { DirectorShell } from "@/components/director/director-shell";
import { ExecutivePreparationView } from "@/components/tasks/executive-preparation-view";
import { wibDate } from "@/lib/director/director-data";
import { requireDirectorPage } from "@/lib/director/director-access";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Persiapan Rapat | MelindaOS", description: "Kesiapan rapat dan koordinasi Asisten Direktur.", robots: { index: false, follow: false } };

export default async function PersiapanPage() {
  const today = wibDate();
  const authenticated = await requireDirectorPage("/arahan/persiapan");
  return (
    <DirectorShell date={today} pending={null} authenticated={authenticated} followLatest activeSection="arahan">
      <div className="page-content director-page report-page">
        <header className="page-heading">
          <div><span className="director-eyebrow">RSIA Melinda DHAI · Kantor Direktur</span>
            <h1>Persiapan rapat</h1>
            <p className="m-0 text-slate-600">Jadwal bersama, konfirmasi peserta, bahan rapat, kesiapan asisten, dan bukti arsip.</p></div>
          <Link href="/arahan" prefetch={false} className="task-link">Kembali ke arahan</Link>
        </header>
        {authenticated ? <ExecutivePreparationView today={today} /> :
          <p role="status" className="director-notice">Informasi persiapan rapat hanya tersedia setelah masuk sebagai Direktur.</p>}
      </div>
    </DirectorShell>
  );
}
