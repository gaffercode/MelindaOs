import type { Metadata } from "next";
import { Suspense } from "react";
import { DirectorShell } from "@/components/director/director-shell";
import { LoadingState } from "@/components/loading-state";
import { MelindaBriefGate } from "@/components/melinda-brief/melinda-brief-gate";
import { SystemStatusCard } from "@/components/system-status-card";
import { wibDate } from "@/lib/director/director-data";
import { requirePagePermission } from "@/lib/director/director-access";
import { publicPrincipal } from "@/lib/access/access-control";

export const metadata: Metadata = {
  title: "RSIA Melinda DHAI | Management Morning Brief | MelindaOS",
  description: "Management Morning Brief operasional dan pelayanan RSIA Melinda DHAI Kediri.",
};

export default async function Page({ searchParams }: { searchParams: Promise<{ tanggal?: string | string[] }> }) {
  const today = wibDate();
  const { tanggal } = await searchParams;
  const date = tanggal === undefined ? today : typeof tanggal === "string" ? tanggal : "invalid";
  const { authenticated, principal, allowedPages } = await requirePagePermission(tanggal === undefined ? "/" : `/?tanggal=${date}`);

  return (
    <DirectorShell date={date} pending={null} authenticated={authenticated} followLatest={tanggal === undefined} activeSection="melinda" principal={publicPrincipal(principal)} allowedPages={allowedPages}>
      <div className="page-content director-page report-page">
        <span className="sr-only">Integrated Operations Center (IOC)</span>
        <Suspense key={`status-${date}`} fallback={null}>
          <SystemStatusCard date={date} />
        </Suspense>
        <Suspense key={date} fallback={<p className="director-notice"><LoadingState label="Memuat brief" /></p>}>
          <MelindaBriefGate date={date} allowedPages={allowedPages} />
        </Suspense>
      </div>
    </DirectorShell>
  );
}
