import { authConfiguration, protectedDirectorMode } from "@/lib/director/director-auth";
import { longDate, wibDate } from "@/lib/director/director-data";
import { dashScheduleToBriefEntries } from "@/lib/dash-schedule-entries";
import { readDashScheduleForBrief, type DashScheduleForBrief } from "@/lib/dash-schedule-brief";
import { logError } from "@/lib/log";
import { readBriefing, type MelindaBriefing } from "@/lib/melinda/briefing";
import { readMelindaBrief } from "@/lib/melinda/melinda-brief-store";
import { readMedifySnapshot, type MedifySnapshotResult } from "@/lib/medify/medify-snapshot-store";
import { readMedifyRunStatus } from "@/lib/medify/medify-run-status-store";
import { readSimrsSnapshot, withSimrsSnapshot } from "@/lib/simrs-snapshot";
import { MedifyLivePanel } from "../medify/medify-live-panel";
import { MelindaEntryCard } from "../melinda/melinda-entry-card";
import { ExecutiveSyncBar } from "../work-schedule/executive-sync-bar";
import { RoleSchedulePanel } from "../work-schedule/role-schedule-panel";
import { MelindaMorningBriefView, SectionHeading } from "./melinda-morning-brief";
import { ScheduleTable } from "./schedule-table";

function readableDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const formatted = longDate(value);
  return formatted.includes("Invalid") ? value : formatted;
}

/** Only today's briefing, built from the schedule and Medify data the gate already holds. */
async function entryBriefing(date: string, dash: DashScheduleForBrief, medify: MedifySnapshotResult): Promise<MelindaBriefing | null> {
  const now = new Date();
  if (date !== wibDate(now) || !protectedDirectorMode()) return null;
  try {
    const config = authConfiguration();
    return config ? await readBriefing(config, now, { schedule: dash?.items ?? null, medify }) : null;
  } catch (error) {
    logError("melinda_entry_card", error);
    return null;
  }
}

/**
 * Server component: resolves the published brief (and the census snapshot) for a date and
 * labels exactly what is shown. The page never falls back to a bundled sample.
 *
 * Schedule policy for section 01 ("Jadwal hari ini"):
 * - The Dash schedule store (`schedule_list` for exactly the requested date, no lookback)
 *   wins whenever it has rows, whether the brief for that date is current, stale, or
 *   missing. Dash rows are labeled `Dash · <date>` with storage scope `dash`, so Director
 *   statuses and remarks on Dash rows never bind to brief rows or vice versa.
 * - Dash reachable but empty: when the brief is current for the requested date and has
 *   schedule rows, they are kept with an explicit notice; when the brief is stale, missing
 *   or has no schedule rows (the automatic brief has none), nothing is shown as today —
 *   the section says Dash has not sent a schedule.
 * - Dash unreachable (file mode, misconfigured, store error): the brief rows render
 *   exactly as before.
 * The calendar/source behind Dash is untouched, and every other brief section is unchanged.
 */
export async function MelindaBriefGate({ date, allowedPages }: { date: string; allowedPages?: string[] }) {
  const may = (path: string) => allowedPages === undefined || allowedPages.includes(path);
  const [result, snapshot, medify, runStatus, dash] = await Promise.all([readMelindaBrief(date), readSimrsSnapshot(date), readMedifySnapshot(date), readMedifyRunStatus(date), readDashScheduleForBrief(date)]);
  const status = runStatus.status;
  const failedAfterSnapshot = status?.status === "failed" && (!medify.snapshot || Date.parse(status.completedAt) >= Date.parse(medify.receivedAt));
  const matchingSnapshotRun = status?.status !== "failed" && medify.snapshot?.run?.runId === status?.runId;
  const medifyWithRun = status && (failedAfterSnapshot || matchingSnapshotRun) ? { ...medify, runStatus: status } : medify;
  const dashEntries = dash && dash.items.length > 0 ? dashScheduleToBriefEntries(dash.items) : null;
  const dashEmpty = dash !== null && dash.items.length === 0;
  // The Melinda card, its data and its composer are Director-only: roles without /melinda never fetch or render them.
  const entryCard = may("/melinda") ? <MelindaEntryCard briefing={await entryBriefing(date, dash, medify)} /> : undefined;
  if (!result.brief) {
    return (
      <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <ExecutiveSyncBar date={date} />
      </div>
      <MedifyLivePanel result={medifyWithRun} entryCard={entryCard} />
      {dashEntries ? (
        <section className="swiss-section" aria-label="Jadwal hari ini" aria-labelledby="section-01">
          <SectionHeading id="section-01" number="01" title="Jadwal hari ini" meta={`Dash · ${date}`} note={`Jadwal dari Dash untuk ${date}.`} />
          <ScheduleTable date={date} scope="dash" items={dashEntries} />
        </section>
      ) : null}
      <section className="swiss-section" aria-label="Status brief">
        <p role="status" className={result.status === "invalid" ? "director-notice director-error" : "director-notice"}>{result.message}</p>
        <p className="text-base text-slate-700 m-0">Tanggal diminta: {readableDate(date)}. Belum ada sumber data otomatis untuk brief ini; tidak ada data contoh yang ditampilkan.</p>
      </section>
      {result.status !== "invalid" ? <RoleSchedulePanel date={date} /> : null}
      </>
    );
  }
  const base = snapshot ? withSimrsSnapshot(result.brief, snapshot) : result.brief;
  const stale = result.status === "previous";
  // A current brief with no schedule rows of its own (the automatic brief) has nothing to stand in for Dash.
  const noBriefSchedule = stale || base.schedule.items.length === 0;
  const brief = dashEntries
    ? {
        ...base,
        schedule: {
          headerRight: `Dash · ${date}`,
          items: dashEntries,
          catatan: stale && result.sourceDate ? `Jadwal dari Dash untuk ${date}; bagian lain dari brief ${result.sourceDate}.` : `Jadwal dari Dash untuk ${date}.`,
        },
      }
    : base;
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <ExecutiveSyncBar date={date} />
      </div>
      <MelindaMorningBriefView
        brief={brief}
        live={medify.snapshot || medifyWithRun.runStatus?.status === "failed" ? <MedifyLivePanel result={medifyWithRun} number="00" entryCard={entryCard} /> : undefined}
        entryCard={entryCard}
        liveMessage={medify.message}
        medify={medify.snapshot}
        scheduleDate={dashEntries ? date : undefined}
        scheduleScope={dashEntries ? "dash" : undefined}
        scheduleNotice={dashEmpty && !noBriefSchedule ? "Dash belum mengirim jadwal untuk tanggal ini; menampilkan jadwal dari brief." : undefined}
        scheduleEmpty={dashEmpty && noBriefSchedule}
        allowedPages={allowedPages}
      />
      <RoleSchedulePanel date={date} />
    </>
  );
}
