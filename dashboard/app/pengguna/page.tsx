import type { Metadata } from "next";
import { DirectorShell } from "@/components/director/director-shell";
import { UserManagement } from "@/components/access/user-management";
import { wibDate } from "@/lib/director/director-data";
import { requirePagePermission } from "@/lib/director/director-access";
import { publicPrincipal } from "@/lib/access/access-control";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Pengguna | MelindaOS",
  description: "Kelola akun, peran, dan password sementara untuk staf RSIA Melinda DHAI.",
  robots: { index: false, follow: false },
};

export default async function UsersPage() {
  const { authenticated, principal, allowedPages } = await requirePagePermission("/pengguna");
  return (
    <DirectorShell date={wibDate()} pending={null} authenticated={authenticated} followLatest activeSection="pengguna" principal={publicPrincipal(principal)} allowedPages={allowedPages}>
      <div className="page-content director-page report-page">
        <UserManagement />
      </div>
    </DirectorShell>
  );
}
