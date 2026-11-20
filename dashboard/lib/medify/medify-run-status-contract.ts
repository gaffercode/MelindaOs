import schemaDocument from "../../schemas/medify-run-status-v1.schema.json";
import { DAILY_DOCUMENT_MAX_BYTES } from "../daily/daily-documents";
import { validReportDate, wibDate } from "../director/director-data";
import { jsonByteLength, matchClosedSchema, PublisherValidationError } from "../publisher-contract";

export const MEDIFY_RUN_SECTIONS = ["bed", "outpatient", "igd", "inpatient", "inpatientMix", "igdMix", "diagnostics", "pharmacy", "staff", "finance", "satusehat", "patients"] as const;
export type MedifyRunSection = typeof MEDIFY_RUN_SECTIONS[number];
export const MEDIFY_RUN_REASONS = ["login_failed", "request_failed", "format_changed", "response_too_large", "access_denied", "validation_failed", "overlap_denied"] as const;
export type MedifyRunReason = typeof MEDIFY_RUN_REASONS[number];
export type MedifyRunIssue = { section: MedifyRunSection | null; reason: MedifyRunReason };
export type MedifyRun = { slot: "morning" | "evening"; runId: string; status: "complete" | "degraded"; startedAt: string; completedAt: string; unavailableSections: { section: MedifyRunSection; reason: MedifyRunReason }[] };
export type MedifyRunStatus = { schemaVersion: 1; date: string; slot: "morning" | "evening"; runId: string; status: "complete" | "degraded" | "failed"; startedAt: string; completedAt: string; unavailableSections: MedifyRunIssue[]; snapshotRevisionId: string | null; snapshotReceivedAt: string | null };

const timestamp = (value: string, path: string, date: string) => {
  if (!Number.isFinite(Date.parse(value)) || wibDate(new Date(value)) !== date) throw new PublisherValidationError(path);
};

export function assertMedifyRun(value: unknown, date: string, path: string): asserts value is MedifyRun {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new PublisherValidationError(path);
  const run = value as MedifyRun;
  if (!(["morning", "evening"] as const).includes(run.slot) || !/^[A-Za-z0-9_-]{8,80}$/.test(run.runId) || !(["complete", "degraded"] as const).includes(run.status) || !Array.isArray(run.unavailableSections)) throw new PublisherValidationError(path);
  timestamp(run.startedAt, `${path}.startedAt`, date); timestamp(run.completedAt, `${path}.completedAt`, date);
  if (Date.parse(run.startedAt) > Date.parse(run.completedAt)) throw new PublisherValidationError(`${path}.completedAt`);
  if ((run.status === "complete") !== (run.unavailableSections.length === 0)) throw new PublisherValidationError(`${path}.unavailableSections`);
  for (const issue of run.unavailableSections) if (!issue || !MEDIFY_RUN_SECTIONS.includes(issue.section) || !MEDIFY_RUN_REASONS.includes(issue.reason)) throw new PublisherValidationError(`${path}.unavailableSections`);
}

export function parseMedifyRunStatus(value: unknown): MedifyRunStatus {
  if (jsonByteLength(value, "document") > DAILY_DOCUMENT_MAX_BYTES) throw new PublisherValidationError("document.size");
  matchClosedSchema(value, schemaDocument, "document");
  const status = value as MedifyRunStatus;
  if (!validReportDate(status.date)) throw new PublisherValidationError("document.date");
  timestamp(status.startedAt, "document.startedAt", status.date); timestamp(status.completedAt, "document.completedAt", status.date);
  if (Date.parse(status.startedAt) > Date.parse(status.completedAt)) throw new PublisherValidationError("document.completedAt");
  if ((status.status === "complete") !== (status.unavailableSections.length === 0)) throw new PublisherValidationError("document.unavailableSections");
  if (status.status !== "complete" && !status.unavailableSections.length) throw new PublisherValidationError("document.unavailableSections");
  if ((status.snapshotRevisionId === null) !== (status.snapshotReceivedAt === null)) throw new PublisherValidationError("document.snapshotReceipt");
  if (status.snapshotReceivedAt !== null) timestamp(status.snapshotReceivedAt, "document.snapshotReceivedAt", status.date);
  return status;
}
