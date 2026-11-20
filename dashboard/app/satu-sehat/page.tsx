import type { Metadata } from "next";
import { DirectorShell } from "@/components/director/director-shell";
import { SatuSehatView } from "@/components/satusehat/satu-sehat-view";
import { publicPrincipal } from "@/lib/access/access-control";
import { requirePagePermission } from "@/lib/director/director-access";
import { wibDate } from "@/lib/director/director-data";
import { readMedifySnapshot } from "@/lib/medify/medify-snapshot-store";
import { satusehatOAuthConfigured } from "@/lib/satusehat/satusehat-oauth-client";
import { readSatusehatSnapshot } from "@/lib/satusehat/satusehat-snapshot-store";

export const metadata: Metadata = {
  title: "Satu Sehat | Ringkasan Pengiriman Data Kemenkes | MelindaOS",
  description:
    "Ringkasan pengiriman catatan medis ke Satu Sehat Kemenkes, perbandingan data Medify, dan analisis kesiapan rumah sakit RSIA Melinda DHAI.",
  robots: { index: false, follow: false },
};

export default async function SatuSehatPage({
  searchParams,
}: {
  searchParams: Promise<{ tanggal?: string | string[] }>;
}) {
  const today = wibDate();
  const { tanggal } = await searchParams;
  const date = tanggal === undefined ? today : typeof tanggal === "string" ? tanggal : "invalid";
  const { authenticated, principal, allowedPages } = await requirePagePermission(
    tanggal === undefined ? "/satu-sehat" : `/satu-sehat?tanggal=${date}`,
  );
  const [medifyResult, satusehatResult] = await Promise.all([
    readMedifySnapshot(date),
    readSatusehatSnapshot(date),
  ]);

  return (
    <DirectorShell
      date={date}
      pending={null}
      authenticated={authenticated}
      principal={publicPrincipal(principal)}
      allowedPages={allowedPages}
      followLatest={tanggal === undefined}
      activeSection="satu-sehat"
    >
      <div className="page-content director-page report-page">
        <SatuSehatView
          date={date}
          medifyResult={medifyResult}
          satusehatResult={satusehatResult}
          oauthConfigured={satusehatOAuthConfigured()}
        />
      </div>
    </DirectorShell>
  );
}
