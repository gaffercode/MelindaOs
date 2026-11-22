import { requireConfiguration } from "./director/director-api";
import { type DirectorAuthConfiguration, medifyPublisherConfiguration, protectedDirectorMode } from "./director/director-auth";
import { wibDate, wibTime } from "./director/director-data";
import { type Instruction } from "./director/director-instructions";
import { OPEN_WINDOW_DEFAULT_DAYS, openInstructions } from "./director/director-instructions-api";
import { DirectorStoreError } from "./director/director-store";
import { latestDailyDocument, readDailyDocument } from "./daily/daily-documents";
import { MEDIFY_MAX_AGE_MS, SERVICE_HOURS } from "./freshness";
import { logError } from "./log";
import { parseMedifyRunStatus, type MedifyRunStatus } from "./medify/medify-run-status-contract";
import { MIGRATION_NAMES } from "./migration-names";
import { satusehatOAuthConfigured } from "./satusehat/satusehat-oauth-client";

/**
 * Operational self-check shown on the Director's home page (`readSystemStatus`).
 *
 * Alerts:
 * - an instruction already handed to staff (open window, see `openInstructions`) passed its deadline without `selesai`;
 * - no census snapshot has been published for today by the census deadline (WIB), or the Medify pull went stale;
 * - a scheduled Medify pull on one of the previous `MISSED_PULL_LOOKBACK_DAYS` days left no complete run (see `missedMedifyPulls`);
 * - no SATUSEHAT snapshot has arrived for today by the census deadline (see `satusehatMissingDetail`).
 */
export type OpsAlert = { code: "instruction_overdue" | "snapshot_missing" | "snapshot_stale" | "medify_pull_missed" | "satusehat_missing"; detail: string };
export type OpsReport = { checkedAt: string; date: string; alerts: OpsAlert[]; latestSnapshot: string | null };

const SNAPSHOT_DEADLINE = "07:00";
/** Past days checked for scheduled Medify pulls that never completed. Today is covered by `snapshot_missing` and `snapshot_stale`. */
export const MISSED_PULL_LOOKBACK_DAYS = 7;

/** `YYYY-MM-DD` shifted by `days` (calendar arithmetic on the WIB date string, no time zone involved). */
function shiftDate(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

/**
 * What one past day's latest `medify_run_status` says about its two scheduled pulls (06:00 and 18:00 WIB).
 * The store keeps the latest status per day, so only these cases are knowable:
 * - no status at all: neither pull ran (the scheduler never started, or the host was down);
 * - latest is the morning slot: the evening pull never ran;
 * - latest status `failed`: that slot ran and failed.
 * A day whose latest status is a complete or degraded evening pull is treated as fine; a morning pull
 * missed on such a day cannot be seen from the latest status alone.
 */
export function missedSlotsForDay(status: Pick<MedifyRunStatus, "slot" | "status"> | null): string[] {
  if (!status) return ["pagi", "sore"];
  const failed = status.status === "failed";
  if (status.slot === "morning") return failed ? ["pagi gagal", "sore"] : ["sore"];
  return failed ? ["sore gagal"] : [];
}

/**
 * Scheduled Medify pulls on the previous `MISSED_PULL_LOOKBACK_DAYS` days that did not complete, newest
 * first, as `DD-MM (slots)`. A day whose status cannot be read is reported as unreadable, never as missed
 * or as fine.
 */
export async function missedMedifyPulls(config: DirectorAuthConfiguration, today: string): Promise<string[]> {
  const days = Array.from({ length: MISSED_PULL_LOOKBACK_DAYS }, (_, index) => shiftDate(today, -(index + 1)));
  const reads = await Promise.all(days.map(async (date) => {
    try {
      const { document } = await readDailyDocument("medify_run_status", date, 0, { config });
      if (!document) return { date, state: "none" as const };
      const status = parseMedifyRunStatus(document.payload);
      return status.date === date ? { date, state: "read" as const, status } : { date, state: "unreadable" as const };
    } catch (error) {
      logError("ops_medify_missed_read", error);
      return { date, state: "unreadable" as const };
    }
  }));
  const label = (date: string) => `${date.slice(8, 10)}-${date.slice(5, 7)}`;
  return reads.flatMap((read) => {
    if (read.state === "unreadable") return [`${label(read.date)} (status tidak terbaca)`];
    const slots = missedSlotsForDay(read.state === "read" ? read.status : null);
    return slots.length ? [`${label(read.date)} (${slots.join(", ")})`] : [];
  });
}

/** Vercel Cron authenticates with `CRON_SECRET`; `requireVercelCron` refuses anything shorter than 16 characters. */
const CRON_SECRET_MIN_LENGTH = 16;

/**
 * Why today's SATUSEHAT snapshot is missing, naming the server setting to check first. Only whether a
 * setting is present is read, never its value. `latest` is the newest stored snapshot date, if any.
 */
export function satusehatMissingDetail(date: string, latest: string | null, env: NodeJS.ProcessEnv = process.env): string {
  const last = `terakhir: ${latest ?? "belum pernah"}`;
  if (!satusehatOAuthConfigured(env)) return `Belum ada data SATUSEHAT untuk ${date} (${last}). Kredensial SATUSEHAT (SATUSEHAT_CLIENT_ID, SATUSEHAT_CLIENT_SECRET, SATUSEHAT_ORG_ID) belum lengkap di server dashboard.`;
  if ((env.CRON_SECRET?.trim() ?? "").length < CRON_SECRET_MIN_LENGTH) return `Belum ada data SATUSEHAT untuk ${date} (${last}). CRON_SECRET belum dipasang di Vercel, sehingga jadwal otomatis 05.55 dan 17.55 WIB ditolak.`;
  return `Belum ada data SATUSEHAT untuk ${date} (${last}). Pengaturan lengkap; periksa log cron /api/cron/satusehat di Vercel.`;
}

function hhmm(time: string): string { return time.slice(0, 5); }
/** `YYYY-MM-DDTHH:mm` (WIB, the instruction deadline format) as `DD-MM-YYYY HH.MM WIB`. */
function deadlineLabel(deadline: string): string { return `${deadline.slice(8, 10)}-${deadline.slice(5, 7)}-${deadline.slice(0, 4)} ${deadline.slice(11, 16).replace(":", ".")} WIB`; }
const delivered = new Set<Instruction["status"]>(["terkirim_ke_grokbot", "diteruskan", "diterima_pic", "dikerjakan"]);

export async function collectOpsAlerts(now = new Date()): Promise<OpsReport> {
  const config = requireConfiguration();
  const date = wibDate(now);
  const alerts: OpsAlert[] = [];
  const time = hhmm(wibTime(now.toISOString()));
  const { instructions: open } = await openInstructions(config, date, OPEN_WINDOW_DEFAULT_DAYS);
  for (const instruction of open) {
    if (instruction.deadline && delivered.has(instruction.status) && instruction.deadline < `${date}T${time}`) alerts.push({ code: "instruction_overdue", detail: `${instruction.id} (${instruction.itemTitle.slice(0, 80)}) melewati tenggat ${deadlineLabel(instruction.deadline)}, status ${instruction.status}.` });
  }
  const [medify, census, satusehat] = await Promise.all([latestDailyDocument(config, "medify_snapshot"), latestDailyDocument(config, "simrs_snapshot"), latestDailyDocument(config, "satusehat_snapshot")]);
  // Medify is the primary census source; the manual SIMRS export (routine B) only covers a day Medify could not.
  const snapshot = medify?.report_date === date ? medify : census?.report_date === date ? census : medify ?? census;
  if (time >= SNAPSHOT_DEADLINE && snapshot?.report_date !== date) alerts.push({ code: "snapshot_missing", detail: `Belum ada tarikan Medify untuk ${date} (terakhir: ${snapshot?.report_date ?? "belum pernah"}).` });
  else if (medify?.report_date === date && time >= SERVICE_HOURS.from && time <= SERVICE_HOURS.to && now.getTime() - Date.parse(medify.received_at) > MEDIFY_MAX_AGE_MS) alerts.push({ code: "snapshot_stale", detail: `Tarikan Medify terakhir ${wibTime(medify.received_at)}; tidak ada tarikan baru lebih dari 13 jam pada jam layanan.` });
  if (time >= SNAPSHOT_DEADLINE && satusehat?.report_date !== date) alerts.push({ code: "satusehat_missing", detail: satusehatMissingDetail(date, satusehat?.report_date ?? null) });
  const missed = medify ? await missedMedifyPulls(config, date) : [];
  if (missed.length) alerts.push({ code: "medify_pull_missed", detail: `Tarikan Medify terjadwal tidak lengkap dalam ${MISSED_PULL_LOOKBACK_DAYS} hari terakhir: ${missed.join("; ")}. Periksa jadwal di server Biznet.` });
  return { checkedAt: now.toISOString(), date, alerts, latestSnapshot: snapshot?.report_date ?? null };
}

export type DatabaseCause = "unauthorized" | "missing_function" | "unreachable" | "unknown";
export type SystemStatus = {
  /** Migration file names (without .sql) that are in the repository and not in the ledger, ascending. */
  missingMigrations: string[];
  ledger: "ok" | "not_installed" | "unreadable";
  /** Whether the Medify publisher token is configured; without it every pull is refused before storage. */
  medifyReceiver: "configured" | "not_configured";
  checks: { state: "ok" } | { state: "alerts"; alerts: OpsAlert[] } | { state: "unavailable"; cause: DatabaseCause };
};

const SCHEMA_STATUS_MIGRATION = "202611110004_schema_status";

function databaseCause(error: unknown): DatabaseCause {
  if (error instanceof DirectorStoreError && (error.code === "unauthorized" || error.code === "missing_function" || error.code === "unreachable")) return error.code;
  return "unknown";
}

/** The ledger answer is untrusted: only an object whose `versions` is an array of strings is accepted. */
function ledgerVersions(answer: unknown): Set<string> | null {
  if (typeof answer !== "object" || answer === null || !("versions" in answer) || !Array.isArray(answer.versions)) return null;
  const versions: unknown[] = answer.versions;
  return versions.every((version): version is string => typeof version === "string") ? new Set<string>(versions) : null;
}

async function readLedger(): Promise<Pick<SystemStatus, "missingMigrations" | "ledger">> {
  try {
    const versions = ledgerVersions(await requireConfiguration().store.call<unknown>("ledger", {}, "melinda_schema_status"));
    if (!versions) throw new DirectorStoreError(503, "invalid_response");
    return { ledger: "ok", missingMigrations: MIGRATION_NAMES.filter((name) => !versions.has(name.slice(0, 12))) };
  } catch (error) {
    logError("system_status_ledger", error);
    return error instanceof DirectorStoreError && error.code === "missing_function"
      ? { ledger: "not_installed", missingMigrations: [SCHEMA_STATUS_MIGRATION] }
      : { ledger: "unreadable", missingMigrations: [] };
  }
}

async function readChecks(now: Date): Promise<SystemStatus["checks"]> {
  try {
    const { alerts } = await collectOpsAlerts(now);
    return alerts.length ? { state: "alerts", alerts } : { state: "ok" };
  } catch (error) {
    const cause = databaseCause(error);
    logError(`system_status_${cause}`, error);
    return { state: "unavailable", cause };
  }
}

/**
 * The findings above for the Director's home page, plus the migrations in the repository that the
 * database has not recorded. Null when there is nothing to check: file mode, or a date other than
 * today. A failed operational check is always shown, never as "all clear". A ledger read that
 * alone cannot be read is logged (`system_status_ledger`), not shown. The two reads run together
 * and neither failure hides the other's result. An operational failure is logged as
 * `system_status_<cause>`.
 */
export async function readSystemStatus(date: string, now = new Date()): Promise<SystemStatus | null> {
  if (!protectedDirectorMode() || date !== wibDate(now)) return null;
  const [ledger, checks] = await Promise.all([readLedger(), readChecks(now)]);
  const medifyReceiver = medifyPublisherConfiguration() ? "configured" : "not_configured";
  return { ...ledger, checks, medifyReceiver };
}
