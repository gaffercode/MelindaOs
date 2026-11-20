import type { Metadata } from "next";
import { DirectorShell } from "@/components/director/director-shell";
import { StarkesReadinessView } from "@/components/starkes/starkes-readiness-view";
import { wibDate } from "@/lib/director/director-data";
import { requirePagePermission } from "@/lib/director/director-access";
import { publicPrincipal } from "@/lib/access/access-control";
import { loadStarkesTeams } from "@/lib/starkes/starkes-team";

export const metadata: Metadata = {
  title: "STARKES | Kesiapan Survei Akreditasi | MelindaOS",
  description: "Kesiapan survei akreditasi STARKES RSIA Melinda DHAI dari bukti yang disetujui Direktur.",
};

export default async function StarkesTrackerPage({
  searchParams,
}: {
  searchParams: Promise<{ tanggal?: string | string[] }>;
}) {
  const today = wibDate();
  const { tanggal } = await searchParams;
  const date = tanggal === undefined ? today : typeof tanggal === "string" ? tanggal : "invalid";
  const { authenticated, principal, allowedPages } = await requirePagePermission(tanggal === undefined ? "/starkes" : `/starkes?tanggal=${date}`);
  // Read only after the permission check above, which redirects anyone without access.
  const loadedTeams = await loadStarkesTeams();

  return (
    <DirectorShell
      date={date}
      pending={null}
      authenticated={authenticated}
      principal={publicPrincipal(principal)}
      allowedPages={allowedPages}
      followLatest={tanggal === undefined}
      activeSection="starkes"
    >
      <div className="page-content director-page report-page">
        <StarkesReadinessView auditRole={principal?.kind === "director" ? "director" : null} teams={loadedTeams?.teams ?? null} />
      </div>
    </DirectorShell>
  );
}
