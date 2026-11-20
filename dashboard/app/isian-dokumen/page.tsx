import type { Metadata } from "next";
import { DirectorShell } from "@/components/director/director-shell";
import { DocumentAnswers } from "@/components/knowledge/document-answers";
import { publicPrincipal } from "@/lib/access/access-control";
import { requirePagePermission } from "@/lib/director/director-access";
import { wibDate } from "@/lib/director/director-data";
import { loadDirectorQueue } from "@/lib/director/director-queue";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Isian dokumen | MelindaOS",
  description: "Antrean butir dokumen RSIA Melinda DHAI yang menunggu jawaban Direktur.",
  robots: { index: false, follow: false },
};

export default async function DocumentAnswersPage() {
  const { authenticated, principal, allowedPages } = await requirePagePermission("/isian-dokumen");
  const queue = await loadDirectorQueue();
  return (
    <DirectorShell date={wibDate()} pending={null} authenticated={authenticated} followLatest activeSection="isian-dokumen" principal={publicPrincipal(principal)} allowedPages={allowedPages}>
      <div className="page-content director-page report-page">
        <DocumentAnswers queue={queue} />
      </div>
    </DirectorShell>
  );
}
