import type { Metadata } from "next";
import { DirectorShell } from "@/components/director/director-shell";
import { ReferralInbox } from "@/components/referral/referral-inbox";
import { publicPrincipal } from "@/lib/access/access-control";
import { requirePagePermission } from "@/lib/director/director-access";
import { authConfiguration, protectedDirectorMode } from "@/lib/director/director-auth";
import { wibDate } from "@/lib/director/director-data";
import { listInboxReferrals } from "@/lib/referral/referral-store";
import { REFERRAL_STATUSES, type ReferralStatus, type StoredReferral } from "@/lib/referral/referral-types";

export const metadata: Metadata = {
  title: "Rujukan masuk | MelindaOS",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

function filterStatus(value: string | string[] | undefined): ReferralStatus | undefined {
  return typeof value === "string" && (REFERRAL_STATUSES as readonly string[]).includes(value) ? (value as ReferralStatus) : undefined;
}

export default async function ReferralInboxPage({ searchParams }: { searchParams: Promise<{ status?: string | string[] }> }) {
  const { principal, allowedPages } = await requirePagePermission("/rujukan-masuk");
  const status = filterStatus((await searchParams).status);
  let referrals: StoredReferral[] = [];
  let unavailable = "";
  if (!protectedDirectorMode()) {
    unavailable = "Rujukan masuk hanya tersedia saat dashboard memakai penyimpanan Supabase.";
  } else {
    try {
      const config = authConfiguration();
      if (!config) throw new Error("configuration");
      referrals = await listInboxReferrals(config);
    } catch {
      unavailable = "Rujukan masuk belum tersedia. Penyimpanan atau pembaruan database belum siap.";
    }
  }

  return (
    <DirectorShell
      date={wibDate()}
      pending={null}
      authenticated
      followLatest={false}
      activeSection="rujukan-masuk"
      principal={publicPrincipal(principal)}
      allowedPages={allowedPages}
    >
      <div className="page-content director-page referral-inbox-page">
        <ReferralInbox initial={referrals} initialStatus={status ?? "semua"} unavailable={unavailable} />
      </div>
    </DirectorShell>
  );
}
