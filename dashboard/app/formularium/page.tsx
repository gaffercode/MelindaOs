import type { Metadata } from "next";
import { DirectorShell } from "@/components/director/director-shell";
import { FormulariumView } from "@/components/pharmacy/formularium-view";
import { wibDate } from "@/lib/director/director-data";
import { requirePagePermission } from "@/lib/director/director-access";
import { publicPrincipal } from "@/lib/access/access-control";
import { readFormulariumSource } from "@/lib/pharmacy/formularium-source";

export const metadata: Metadata = {
  title: "Formularium DPJP | MelindaOS",
  description: "Daftar obat dan BHP dari DPJP, dibaca sistem dari berkas Excel. Terpisah dari berkas pengajuan order obat; belum diverifikasi terhadap sediaan resmi.",
  robots: { index: false, follow: false },
};

export default async function FormulariumPage({ searchParams }: { searchParams: Promise<{ tanggal?: string | string[] }> }) {
  const today = wibDate();
  const { tanggal } = await searchParams;
  const date = tanggal === undefined ? today : typeof tanggal === "string" ? tanggal : "invalid";
  const { authenticated, principal, allowedPages } = await requirePagePermission(tanggal === undefined ? "/formularium" : `/formularium?tanggal=${date}`);
  const source = await readFormulariumSource();

  return (
    <DirectorShell date={date} pending={null} authenticated={authenticated} followLatest={tanggal === undefined} activeSection="formularium" principal={publicPrincipal(principal)} allowedPages={allowedPages}>
      <div className="page-content director-page report-page">
        <FormulariumView fileName={source.fileName} byteSize={source.byteSize} reading={source.reading} />
      </div>
    </DirectorShell>
  );
}
