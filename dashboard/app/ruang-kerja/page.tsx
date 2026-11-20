import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { DirectorShell } from "@/components/director/director-shell";
import { StaffWorkspace } from "@/components/staff-workspace";
import { requirePagePermission } from "@/lib/director/director-access";
import { publicPrincipal } from "@/lib/access/access-control";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Ruang kerja | MelindaOS",
  description: "Modul, Tanya Melinda, dan pencarian dokumen untuk staf RSIA Melinda DHAI.",
  robots: { index: false, follow: false },
};

export default async function StaffWorkspacePage() {
  const { authenticated, principal, allowedPages } = await requirePagePermission("/ruang-kerja");
  const person = publicPrincipal(principal);
  if (!person) redirect("/");
  return (
    <DirectorShell date={new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date())} pending={null} authenticated={authenticated} followLatest activeSection="ruang-kerja" principal={person} allowedPages={allowedPages}>
      <div className="page-content director-page report-page">
        <StaffWorkspace principal={person} allowedPages={allowedPages} />
      </div>
    </DirectorShell>
  );
}
