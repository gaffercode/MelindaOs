import schemaDocument from "../../schemas/satusehat-snapshot-v1.schema.json";
import { DAILY_DOCUMENT_MAX_BYTES } from "../daily/daily-documents";
import { assertPublication, jsonByteLength, matchClosedSchema, PublisherValidationError, type DocumentProvenance } from "../publisher-contract";

export type SatusehatEnvironment = "production" | "staging";
export type SatusehatSnapshotSource = "oauth2_fhir_api" | "portal_export";
export type SatusehatResourcePeriodMode = "rolling_30d" | "all_time";

export type SatusehatSnapshotResource = {
  name: string;
  count: number;
  status: "ok" | "unavailable";
  periodMode: SatusehatResourcePeriodMode;
};

export type SatusehatLogSummary = {
  totalTransactions: number;
  successfulTransactions: number;
  failedTransactions: number;
  successRatePercent: number;
  failureRatePercent: number;
};

export type SatusehatSnapshot = {
  schemaVersion: 1;
  date: string;
  environment: SatusehatEnvironment;
  organizationId: string;
  facilityCode: string;
  facilityName: string;
  observedAt: string;
  periodStart: string;
  periodEnd: string;
  periodLabel: string;
  source: SatusehatSnapshotSource;
  logSummary: SatusehatLogSummary | null;
  resources: SatusehatSnapshotResource[];
  unavailableResources: string[];
  provenance: DocumentProvenance;
};

/** Validates a SATUSEHAT aggregate snapshot against the closed JSON schema and publication rules. */
export function parseSatusehatSnapshot(value: unknown): SatusehatSnapshot {
  if (jsonByteLength(value, "document") > DAILY_DOCUMENT_MAX_BYTES) throw new PublisherValidationError("document.size");
  matchClosedSchema(value, schemaDocument, "document");
  const snapshot = value as SatusehatSnapshot;
  assertPublication(snapshot, "document");
  if (snapshot.periodStart > snapshot.periodEnd || snapshot.periodEnd > snapshot.date) {
    throw new PublisherValidationError("document.period");
  }
  const validPercentage = (candidate: unknown) => typeof candidate === "number" && Number.isFinite(candidate) && candidate >= 0 && candidate <= 100;
  if (snapshot.logSummary) {
    if (!validPercentage(snapshot.logSummary.successRatePercent) || !validPercentage(snapshot.logSummary.failureRatePercent)) {
      throw new PublisherValidationError("document.logSummary.percent");
    }
    if (snapshot.logSummary.successfulTransactions + snapshot.logSummary.failedTransactions > snapshot.logSummary.totalTransactions * 2) {
      throw new PublisherValidationError("document.logSummary.counts");
    }
  }
  const seen = new Set<string>();
  for (const resource of snapshot.resources) {
    if (seen.has(resource.name)) throw new PublisherValidationError("document.resources");
    seen.add(resource.name);
  }
  return snapshot;
}
