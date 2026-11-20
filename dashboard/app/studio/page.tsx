import type { Metadata } from "next";
import { DirectorShell } from "@/components/director/director-shell";
import { DocumentStudioView } from "@/components/studio/document-studio-view";
import { wibDate } from "@/lib/director/director-data";
import { requireDirectorPage } from "@/lib/director/director-access";

export const metadata: Metadata = {
  title: "Melinda Studio | Generator Dokumen Standar RS & SK Direktur | MelindaOS",
  description:
    "Generator resmi penyusunan Standar Prosedur Operasional (SPO) 9 elemen STARKES dan Surat Keputusan Direktur RSIA Melinda DHAI Kediri.",
};

export default async function DocumentStudioPage({
  searchParams,
}: {
  searchParams: Promise<{ tanggal?: string | string[] }>;
}) {
  const today = wibDate();
  const { tanggal } = await searchParams;
  const date = tanggal === undefined ? today : typeof tanggal === "string" ? tanggal : "invalid";
  const authenticated = await requireDirectorPage(
    tanggal === undefined ? "/studio" : `/studio?tanggal=${date}`
  );

  return (
    <DirectorShell
      date={date}
      pending={null}
      authenticated={authenticated}
      followLatest={tanggal === undefined}
      activeSection="studio"
    >
      <div className="page-content director-page report-page">
        <DocumentStudioView pdfAvailable />
      </div>
    </DirectorShell>
  );
}
