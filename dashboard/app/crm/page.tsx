import type { Metadata } from "next";
import { DirectorShell } from "@/components/director/director-shell";
import { CrmView } from "@/components/crm/crm-view";
import { wibDate } from "@/lib/director/director-data";
import { requirePagePermission } from "@/lib/director/director-access";
import { publicPrincipal } from "@/lib/access/access-control";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "CRM | MelindaOS",
  description: "Rujukan dan mitra RSIA Melinda DHAI: tahap kerja sama, tindak lanjut, dan volume rujukan.",
  robots: { index: false, follow: false },
};

export default async function CRMPage() {
  const { authenticated, principal, allowedPages } = await requirePagePermission("/crm");
  return (
    <DirectorShell date={wibDate()} pending={null} authenticated={authenticated} followLatest activeSection="crm" principal={publicPrincipal(principal)} allowedPages={allowedPages}>
      <div className="page-content director-page report-page">
        <CrmView />
      </div>
    </DirectorShell>
  );
}
