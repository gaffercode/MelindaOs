import type { Metadata } from "next";
import { DirectorShell } from "@/components/director/director-shell";
import { PharmacyOrderView } from "@/components/pharmacy/pharmacy-order-view";
import { wibDate } from "@/lib/director/director-data";
import { requirePagePermission } from "@/lib/director/director-access";
import { hasPermission, publicPrincipal } from "@/lib/access/access-control";
import { builtInInitialFiles } from "@/lib/pharmacy/order-obat-api";
import { storageConfiguration } from "@/lib/pharmacy/order-obat-storage";

export const metadata: Metadata = {
  title: "Order obat | MelindaOS",
  description: "Berkas pengajuan order obat dibaca sistem (bagian distributor, selisih hitung, blok tanda tangan) dan diputuskan Direktur. Tanpa pesanan, penerimaan, faktur, atau pembayaran.",
  robots: { index: false, follow: false },
};

export default async function PharmacyOrderPage({ searchParams }: { searchParams: Promise<{ tanggal?: string | string[] }> }) {
  const today = wibDate();
  const { tanggal } = await searchParams;
  const date = tanggal === undefined ? today : typeof tanggal === "string" ? tanggal : "invalid";
  const { authenticated, principal, allowedPages } = await requirePagePermission(tanggal === undefined ? "/order-obat" : `/order-obat?tanggal=${date}`);
  const initialFiles = await builtInInitialFiles();

  return (
    <DirectorShell date={date} pending={null} authenticated={authenticated} followLatest={tanggal === undefined} activeSection="order-obat" principal={publicPrincipal(principal)} allowedPages={allowedPages}>
      <div className="page-content director-page report-page">
        <PharmacyOrderView initialFiles={initialFiles} uploadsEnabled={storageConfiguration() !== null} canDecide={principal === null || hasPermission(principal, "pharmacy.decide")} canRemove={principal === null || hasPermission(principal, "director.only")} />
      </div>
    </DirectorShell>
  );
}
