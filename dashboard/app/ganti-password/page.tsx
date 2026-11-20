import type { Metadata } from "next";
import { ChangePassword } from "@/components/access/change-password";
import { DirectorSession } from "@/components/director/director-session";
import { DirectorShell } from "@/components/director/director-shell";
import { wibDate } from "@/lib/director/director-data";
import { requirePagePermission } from "@/lib/director/director-access";
import { publicPrincipal } from "@/lib/access/access-control";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Ganti password | MelindaOS",
  description: "Ganti password akun MelindaOS.",
  robots: { index: false, follow: false },
};

export default async function ChangePasswordPage() {
  const { authenticated, principal, allowedPages } = await requirePagePermission("/ganti-password");
  const person = publicPrincipal(principal);
  // An account that must change its password may open nothing else, so it gets the form without the sidebar.
  if (person?.mustChange) {
    return <main className="mx-auto grid max-w-lg gap-4 p-6"><ChangePassword principal={person} /><DirectorSession kind="account" /></main>;
  }
  return (
    <DirectorShell date={wibDate()} pending={null} authenticated={authenticated} followLatest activeSection="ganti-password" principal={person} allowedPages={allowedPages}>
      <div className="page-content director-page report-page">
        <ChangePassword principal={person} />
      </div>
    </DirectorShell>
  );
}
