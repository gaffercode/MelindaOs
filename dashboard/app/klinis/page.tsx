import type { Metadata } from "next";
import { ClinicalBoard } from "@/components/clinical/clinical-board";
import { DirectorShell } from "@/components/director/director-shell";
import { publicPrincipal } from "@/lib/access/access-control";
import { listClinicalEntries } from "@/lib/clinical/clinical-store";
import type { StoredClinicalEntry } from "@/lib/clinical/clinical-types";
import { requirePagePermission } from "@/lib/director/director-access";
import { authConfiguration, protectedDirectorMode } from "@/lib/director/director-auth";
import { wibDate } from "@/lib/director/director-data";

export const metadata: Metadata = {
  title: "Data klinis | MelindaOS",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function ClinicalPage() {
  const { principal, allowedPages } = await requirePagePermission("/klinis");
  let entries: StoredClinicalEntry[] = [];
  let unavailable = "";
  if (!protectedDirectorMode()) {
    unavailable = "Data klinis hanya tersedia saat dashboard memakai penyimpanan Supabase.";
  } else {
    try {
      const config = authConfiguration();
      if (!config) throw new Error("configuration");
      entries = await listClinicalEntries(config, { status: "aktif", limit: 200 });
    } catch {
      unavailable = "Data klinis belum tersedia. Penyimpanan atau pembaruan database belum siap.";
    }
  }
  const today = wibDate();

  return (
    <DirectorShell
      date={today}
      pending={null}
      authenticated
      followLatest={false}
      activeSection="klinis"
      principal={publicPrincipal(principal)}
      allowedPages={allowedPages}
    >
      <div className="page-content director-page klinis-page">
        <ClinicalBoard initial={entries} today={today} unavailable={unavailable} />
      </div>
    </DirectorShell>
  );
}
