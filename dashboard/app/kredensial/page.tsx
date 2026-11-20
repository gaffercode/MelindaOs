import type { Metadata } from "next";
import { KredensialView } from "@/components/kredensial/kredensial-view";
import { requirePagePermission } from "@/lib/director/director-access";
import { KREDENSIAL_CATEGORIES, KREDENSIAL_DOCUMENTS } from "@/lib/kredensial/kredensial-data";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  robots: { index: false, follow: false },
  title: "Melinda Credentia | Kredensial & Tata Kelola Klinis | RSIA Melinda DHAI",
  description:
    "Ruang kerja internal rekredensialing BPJS 2026 RSIA Melinda DHAI. Daftar bukti belum membuktikan persetujuan ataupun pengesahan.",
};

export default async function KredensialPage() {
  const { authenticated, allowedPages } = await requirePagePermission("/kredensial");
  return <KredensialView authenticated={authenticated} allowedPages={allowedPages} categories={KREDENSIAL_CATEGORIES} documents={KREDENSIAL_DOCUMENTS} />;
}
