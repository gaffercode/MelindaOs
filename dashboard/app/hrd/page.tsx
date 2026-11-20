import type { Metadata } from "next";
import { DirectorShell } from "@/components/director/director-shell";
import { HrdEditor } from "@/components/hrd/hrd-editor";
import { HrdView } from "@/components/hrd/hrd-view";
import { loadHrdDirectory } from "@/lib/hrd/hrd-directory";
import { wibDate } from "@/lib/director/director-data";
import { requirePagePermission } from "@/lib/director/director-access";
import { hasPermission, publicPrincipal } from "@/lib/access/access-control";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Organisasi & SDM | MelindaOS",
  description: "Struktur kepemimpinan, direktori pegawai, dan tata kelola jabatan RSIA Melinda DHAI.",
  robots: { index: false, follow: false },
};

export default async function HRDPage({ searchParams }: { searchParams: Promise<{ q?: string | string[]; unit?: string | string[] }> }) {
  const { authenticated, principal, allowedPages } = await requirePagePermission("/hrd");
  const { q, unit } = await searchParams;
  // requirePagePermission has already redirected anyone without access, so the directory is read only for permitted users.
  const directory = await loadHrdDirectory();
  // Saving needs a signed-in session (PUT /api/hrd/directory), so local file mode shows the page read-only.
  const canEdit = principal !== null && hasPermission(principal, "hrd.edit");
  return (
    <DirectorShell date={wibDate()} pending={null} authenticated={authenticated} followLatest activeSection="hrd" principal={publicPrincipal(principal)} allowedPages={allowedPages}>
      <div className="page-content director-page report-page">
        {directory
          ? (
            <HrdView
              directory={directory}
              query={typeof q === "string" ? q : ""}
              unit={typeof unit === "string" ? unit : ""}
              editor={canEdit ? <HrdEditor officials={directory.officials} staff={directory.staff} version={directory.version} updatedAt={directory.updatedAt} updatedBy={directory.updatedBy} /> : null}
            />
          )
          : <p className="staff-note">Data SDM belum dapat dimuat dari penyimpanan privat. Coba lagi nanti.</p>}
      </div>
    </DirectorShell>
  );
}
