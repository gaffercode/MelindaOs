import type { Metadata } from "next";
import { DirectorShell } from "@/components/director/director-shell";
import { NewsEditionGate } from "@/components/news/news-edition-view";
import { wibDate } from "@/lib/director/director-data";
import { requirePagePermission } from "@/lib/director/director-access";
import { publicPrincipal } from "@/lib/access/access-control";

export const metadata: Metadata = {
  title: "Warta & Regulasi | The Gaffer Times & Kebijakan Kesehatan | MelindaOS",
  description: "The Gaffer Times edisi harian serta radar kebijakan dan regulasi kesehatan.",
};

export default async function BeritaPage({ searchParams }: { searchParams: Promise<{ tanggal?: string | string[] }> }) {
  const today = wibDate();
  const { tanggal } = await searchParams;
  const date = tanggal === undefined ? today : typeof tanggal === "string" ? tanggal : "invalid";
  const { authenticated, principal, allowedPages } = await requirePagePermission(tanggal === undefined ? "/berita" : `/berita?tanggal=${date}`);
  return (
    <DirectorShell date={date} pending={null} authenticated={authenticated} followLatest={tanggal === undefined} activeSection="berita" principal={publicPrincipal(principal)} allowedPages={allowedPages}>
      <div className="page-content director-page report-page gaffer-page">
        <NewsEditionGate date={date} />
      </div>
    </DirectorShell>
  );
}
