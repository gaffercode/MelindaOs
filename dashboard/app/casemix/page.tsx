import type { Metadata } from "next";
import { DirectorShell } from "@/components/director/director-shell";
import { CasemixSimulatorView } from "@/components/casemix-simulator-view";
import { wibDate } from "@/lib/director/director-data";
import { requirePagePermission } from "@/lib/director/director-access";
import { publicPrincipal } from "@/lib/access/access-control";

export const metadata: Metadata = {
  title: "Casemix Simulator | Prediksi Klaim & Dispute BPJS | MelindaOS",
  description:
    "Kalkulator tarif INA-CBG, analisis unit cost riil, dan peringatan dini pencegahan dispute klaim BPJS Kesehatan RSIA Melinda DHAI.",
};

export default async function CasemixPage({
  searchParams,
}: {
  searchParams: Promise<{ tanggal?: string | string[] }>;
}) {
  const today = wibDate();
  const { tanggal } = await searchParams;
  const date = tanggal === undefined ? today : typeof tanggal === "string" ? tanggal : "invalid";
  const { authenticated, principal, allowedPages } = await requirePagePermission(
    tanggal === undefined ? "/casemix" : `/casemix?tanggal=${date}`
  );

  return (
    <DirectorShell
      date={date}
      pending={null}
      authenticated={authenticated}
      principal={publicPrincipal(principal)}
      allowedPages={allowedPages}
      followLatest={tanggal === undefined}
      activeSection="casemix"
    >
      <div className="page-content director-page report-page">
        <CasemixSimulatorView />
      </div>
    </DirectorShell>
  );
}
