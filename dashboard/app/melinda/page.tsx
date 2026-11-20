import type { Metadata } from "next";
import { DirectorShell } from "@/components/director/director-shell";
import { MelindaChat } from "@/components/melinda/melinda-chat";
import { requireDirectorPage } from "@/lib/director/director-access";
import { authConfiguration } from "@/lib/director/director-auth";
import { wibDate } from "@/lib/director/director-data";
import { logError } from "@/lib/log";
import { readBriefing } from "@/lib/melinda/briefing";
import { listConversations } from "@/lib/melinda/store";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const metadata: Metadata = {
  title: "Melinda | MelindaOS",
  description: "Melinda membaca jadwal, tugas, dan hal yang perlu perhatian Direktur hari ini.",
  robots: { index: false, follow: false },
};

export default async function MelindaAgentPage() {
  const authenticated = await requireDirectorPage("/melinda");
  const config = authenticated ? authConfiguration() : null;
  const now = new Date();
  const [briefing, conversations] = config
    ? await Promise.all([
      readBriefing(config, now),
      listConversations(config, config.reviewerId).catch((error: unknown) => { logError("melinda_page_history", error); return []; }),
    ])
    : [null, []];

  return (
    <DirectorShell date={wibDate(now)} pending={null} authenticated={authenticated} followLatest activeSection="melinda-agent">
      <div className="page-content director-page report-page">
        {briefing ? <MelindaChat briefing={briefing} initialConversations={conversations} /> : <p className="m-0 text-[length:var(--type-body)] text-[var(--warn)]">Melinda butuh koneksi Supabase.</p>}
      </div>
    </DirectorShell>
  );
}
