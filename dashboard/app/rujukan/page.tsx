import type { Metadata } from "next";
import { ReferralForm } from "@/components/referral/referral-form";
import { wibDate, wibTime } from "@/lib/director/director-data";

export const metadata: Metadata = {
  title: "Lembar rujukan pasien | RSIA Melinda DHAI",
  description: "Kirim rujukan pasien ke RSIA Melinda DHAI dari FKTP, klinik, atau praktik dokter perorangan.",
  robots: { index: false, follow: false },
};

/** The date is per request, so the sheet and the maximum birth date follow the WIB calendar. */
export const dynamic = "force-dynamic";

export default function ReferralPage() {
  return (
    <main className="referral-page-main">
      <ReferralForm today={wibDate()} time={wibTime(new Date().toISOString()).replace(" WIB", "")} whatsapp={process.env.MELINDAOS_REFERRAL_WHATSAPP ?? ""} />
    </main>
  );
}
