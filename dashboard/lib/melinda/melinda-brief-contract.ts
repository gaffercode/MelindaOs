import type {
  ComposerStamp,
  MelindaClaimFinanceItem,
  MelindaDecisionItem,
  MelindaEmailTriage,
  MelindaEmailTriageAccount,
  MelindaFollowUpItem,
  MelindaManagementMorningBrief,
  MelindaPublicationSource,
  MelindaSafetyException,
  MelindaScheduleEntry,
  MelindaServiceIndicator,
  MelindaSimrsMetric,
  MelindaSimrsPulse,
  MelindaStaffingItem,
  MelindaSystemFinding,
} from "./melinda-brief-data";
import { validReportDate } from "../director/director-data";

/**
 * Closed contract for the Management Morning Brief as published data.
 *
 * The brief used to live as a TypeScript constant; it is now stored and read
 * as JSON. Every object is closed (unknown keys rejected), every
 * string is bounded, and the structural shape mirrors `MelindaManagementMorningBrief`.
 * Structural validation is not a PHI detector: publishers must keep patient
 * identities out of the brief.
 */
export const MELINDA_BRIEF_SCHEMA_VERSION = 1;
export const MELINDA_BRIEF_MAX_BYTES = 256_000;
const MAX_ITEMS = 100;
const SHORT = 300;
const LONG = 2_000;
const BADGES = new Set<MelindaSimrsMetric["statusBadge"]>(["NORMAL", "PERHATIAN", "KRITIS", "INFO"]);

export class MelindaBriefValidationError extends Error {
  constructor(public readonly path: string) {
    super(`Format brief tidak valid: ${path}`);
    this.name = "MelindaBriefValidationError";
  }
}

function fail(path: string): never { throw new MelindaBriefValidationError(path); }

function record(value: unknown, path: string, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail(path);
  const entries = value as Record<string, unknown>;
  for (const key of Object.keys(entries)) if (!keys.includes(key)) return fail(`${path}.${/^[a-zA-Z0-9_]{1,40}$/.test(key) ? key : "[unknown]"}`);
  return entries;
}
function text(value: unknown, path: string, max = SHORT, required = true): string {
  if (typeof value !== "string" || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) return fail(path);
  if (required && !value.trim()) return fail(path);
  return value;
}
function count(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) return fail(path);
  return value;
}
function flag(value: unknown, path: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") return fail(path);
  return value;
}
function list<T>(value: unknown, path: string, item: (entry: unknown, itemPath: string) => T, min = 0): T[] {
  if (!Array.isArray(value) || value.length < min || value.length > MAX_ITEMS) return fail(path);
  return value.map((entry, index) => item(entry, `${path}[${index}]`));
}
function strings(value: unknown, path: string, max = LONG): string[] {
  return list(value, path, (entry, itemPath) => text(entry, itemPath, max));
}
function section<T extends Record<string, unknown>>(value: unknown, path: string, keys: readonly string[], build: (entries: Record<string, unknown>) => T): T {
  return build(record(value, path, keys));
}
/** A section's optional analysis paragraph: absent, or a non-empty text. */
function analysis(value: unknown, path: string): { analisis?: string } {
  return value === undefined ? {} : { analisis: text(value, path, LONG) };
}

function scheduleEntry(value: unknown, path: string): MelindaScheduleEntry {
  const entries = record(value, path, ["waktu", "kegiatan", "siapa", "topikTindakLanjut", "isPassed"]);
  const isPassed = flag(entries.isPassed, `${path}.isPassed`);
  return {
    waktu: text(entries.waktu, `${path}.waktu`, 40),
    kegiatan: text(entries.kegiatan, `${path}.kegiatan`),
    siapa: text(entries.siapa, `${path}.siapa`),
    topikTindakLanjut: text(entries.topikTindakLanjut, `${path}.topikTindakLanjut`, LONG, false),
    ...(isPassed === undefined ? {} : { isPassed }),
  };
}
function serviceIndicator(value: unknown, path: string): MelindaServiceIndicator {
  const entries = record(value, path, ["indikator", "nilai"]);
  return { indikator: text(entries.indikator, `${path}.indikator`, 120), nilai: text(entries.nilai, `${path}.nilai`, 200) };
}
function safetyException(value: unknown, path: string): MelindaSafetyException {
  const entries = record(value, path, ["no", "eksepsi", "tindakLanjut"]);
  return { no: count(entries.no, `${path}.no`), eksepsi: text(entries.eksepsi, `${path}.eksepsi`, LONG), tindakLanjut: text(entries.tindakLanjut, `${path}.tindakLanjut`, LONG) };
}
function claimItem(value: unknown, path: string): MelindaClaimFinanceItem {
  const entries = record(value, path, ["pos", "nilaiStatus", "catatan"]);
  return { pos: text(entries.pos, `${path}.pos`), nilaiStatus: text(entries.nilaiStatus, `${path}.nilaiStatus`, LONG), catatan: text(entries.catatan, `${path}.catatan`, LONG, false) };
}
function staffingItem(value: unknown, path: string): MelindaStaffingItem {
  const entries = record(value, path, ["pos", "status"]);
  return { pos: text(entries.pos, `${path}.pos`), status: text(entries.status, `${path}.status`, LONG) };
}
function systemFinding(value: unknown, path: string): MelindaSystemFinding {
  const entries = record(value, path, ["temuan", "keterangan"]);
  return { temuan: text(entries.temuan, `${path}.temuan`), keterangan: text(entries.keterangan, `${path}.keterangan`, LONG) };
}
function triageAccount(value: unknown, path: string): MelindaEmailTriageAccount {
  const entries = record(value, path, ["akun", "total", "perluTindakan", "fyi", "promoOtomatis"]);
  return {
    akun: text(entries.akun, `${path}.akun`),
    total: count(entries.total, `${path}.total`),
    perluTindakan: count(entries.perluTindakan, `${path}.perluTindakan`),
    fyi: count(entries.fyi, `${path}.fyi`),
    promoOtomatis: count(entries.promoOtomatis, `${path}.promoOtomatis`),
  };
}
function triage(value: unknown, path: string): MelindaEmailTriage {
  const entries = record(value, path, ["accounts", "total", "perluTindakanText", "fyiItems", "catatan"]);
  const total = record(entries.total, `${path}.total`, ["total", "perluTindakan", "fyi", "promoOtomatis"]);
  return {
    accounts: list(entries.accounts, `${path}.accounts`, triageAccount),
    total: {
      total: count(total.total, `${path}.total.total`),
      perluTindakan: count(total.perluTindakan, `${path}.total.perluTindakan`),
      fyi: count(total.fyi, `${path}.total.fyi`),
      promoOtomatis: count(total.promoOtomatis, `${path}.total.promoOtomatis`),
    },
    perluTindakanText: text(entries.perluTindakanText, `${path}.perluTindakanText`, LONG, false),
    fyiItems: strings(entries.fyiItems, `${path}.fyiItems`),
    catatan: text(entries.catatan, `${path}.catatan`, LONG, false),
  };
}
function publicationSource(value: unknown, path: string): MelindaPublicationSource {
  const entries = record(value, path, ["sourceId", "label", "periodDate", "observedAt", "receivedAt", "availability", "revision", "contentHash"]);
  const nullableDate = (item: unknown, itemPath: string) => item === null ? null : text(item, itemPath, 40);
  const availability = text(entries.availability, `${path}.availability`, 20) as MelindaPublicationSource["availability"];
  if (!["received", "no_issues", "unavailable", "invalid", "missing"].includes(availability)) return fail(`${path}.availability`);
  if (entries.revision !== null && (typeof entries.revision !== "number" || !Number.isSafeInteger(entries.revision) || entries.revision < 1)) return fail(`${path}.revision`);
  const contentHash = entries.contentHash === null ? null : text(entries.contentHash, `${path}.contentHash`, 64);
  if (contentHash !== null && !/^[a-f0-9]{64}$/.test(contentHash)) return fail(`${path}.contentHash`);
  return { sourceId: text(entries.sourceId, `${path}.sourceId`, 40), label: text(entries.label, `${path}.label`, 80), periodDate: nullableDate(entries.periodDate, `${path}.periodDate`), observedAt: nullableDate(entries.observedAt, `${path}.observedAt`), receivedAt: nullableDate(entries.receivedAt, `${path}.receivedAt`), availability, revision: entries.revision as number | null, contentHash };
}
function decisionItem(value: unknown, path: string): MelindaDecisionItem {
  const entries = record(value, path, ["kode", "keputusan", "rekomendasi", "batas", "urgent"]);
  const urgent = flag(entries.urgent, `${path}.urgent`);
  const kode = text(entries.kode, `${path}.kode`, 20);
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,19}$/.test(kode)) return fail(`${path}.kode`);
  return {
    kode,
    keputusan: text(entries.keputusan, `${path}.keputusan`, LONG),
    rekomendasi: text(entries.rekomendasi, `${path}.rekomendasi`, LONG, false),
    batas: text(entries.batas, `${path}.batas`, 120, false),
    ...(urgent === undefined ? {} : { urgent }),
  };
}
function followUpItem(value: unknown, path: string): MelindaFollowUpItem {
  const entries = record(value, path, ["no", "item", "pemilikAgent", "instructionId"]);
  const instructionId = entries.instructionId === undefined ? undefined : text(entries.instructionId, `${path}.instructionId`, 13);
  if (instructionId !== undefined && !/^IOC-\d{4,9}$/.test(instructionId)) return fail(`${path}.instructionId`);
  return { no: count(entries.no, `${path}.no`), item: text(entries.item, `${path}.item`, LONG), pemilikAgent: text(entries.pemilikAgent, `${path}.pemilikAgent`), ...(instructionId === undefined ? {} : { instructionId }) };
}
export function simrsMetric(value: unknown, path: string): MelindaSimrsMetric {
  const entries = record(value, path, ["kategori", "indikator", "nilai", "statusBadge", "catatan"]);
  const statusBadge = text(entries.statusBadge, `${path}.statusBadge`, 12) as MelindaSimrsMetric["statusBadge"];
  if (!BADGES.has(statusBadge)) return fail(`${path}.statusBadge`);
  return {
    kategori: text(entries.kategori, `${path}.kategori`, 60),
    indikator: text(entries.indikator, `${path}.indikator`, 120),
    nilai: text(entries.nilai, `${path}.nilai`, 200),
    statusBadge,
    catatan: text(entries.catatan, `${path}.catatan`, LONG, false),
  };
}
function simrsPulse(value: unknown, path: string): MelindaSimrsPulse {
  const entries = record(value, path, ["headerRight", "systemUrl", "platformVersion", "syncStatus", "metrics", "catatan"]);
  const systemUrl = text(entries.systemUrl, `${path}.systemUrl`, 200);
  if (!URL.canParse(systemUrl) || new URL(systemUrl).protocol !== "https:") return fail(`${path}.systemUrl`);
  const catatan = entries.catatan === undefined ? undefined : text(entries.catatan, `${path}.catatan`, LONG, false);
  return {
    headerRight: text(entries.headerRight, `${path}.headerRight`, 80, false),
    systemUrl,
    platformVersion: text(entries.platformVersion, `${path}.platformVersion`, 80),
    syncStatus: text(entries.syncStatus, `${path}.syncStatus`, 120),
    metrics: list(entries.metrics, `${path}.metrics`, simrsMetric, 1).slice(0, 12),
    ...(catatan === undefined ? {} : { catatan }),
  };
}

function composerStamp(value: unknown, path: string): ComposerStamp {
  const entries = record(value, path, ["outcome", "at", "modelCalled", "facts", "decisions"]);
  const outcome = text(entries.outcome, `${path}.outcome`, 40) as ComposerStamp["outcome"];
  if (outcome !== "stored" && outcome !== "stored_without_analysis") return fail(`${path}.outcome`);
  return {
    outcome,
    at: text(entries.at, `${path}.at`, 40),
    modelCalled: flag(entries.modelCalled, `${path}.modelCalled`) ?? false,
    facts: count(entries.facts, `${path}.facts`),
    decisions: count(entries.decisions, `${path}.decisions`),
  };
}

const ROOT_KEYS = [
  "schemaVersion", "docType", "facility", "title", "date", "dateIso", "sources", "status", "catatanStatus", "untuk", "disiapkanOleh", "nomorVersi", "systemDoctrine", "composer",
  "simrsPulse", "schedule", "serviceSummary", "safetyQuality", "claimsFinance", "staffing", "systemFindings", "emailTriage", "decisions", "dataLimitations", "followUps", "conclusion", "runningFooter", "publication",
] as const;

/** Parse an untrusted value into a brief. Throws `MelindaBriefValidationError` on any deviation. */
export function parseMelindaBrief(value: unknown): MelindaManagementMorningBrief {
  let bytes: number;
  try { bytes = new TextEncoder().encode(JSON.stringify(value)).byteLength; } catch { return fail("brief"); }
  if (bytes > MELINDA_BRIEF_MAX_BYTES) return fail("brief.size");
  const root = record(value, "brief", ROOT_KEYS);
  if (root.schemaVersion !== undefined && root.schemaVersion !== MELINDA_BRIEF_SCHEMA_VERSION) return fail("brief.schemaVersion");
  const dateIso = text(root.dateIso, "brief.dateIso", 10);
  if (!validReportDate(dateIso)) return fail("brief.dateIso");
  const brief: MelindaManagementMorningBrief = {
    docType: text(root.docType, "brief.docType", 80),
    facility: text(root.facility, "brief.facility", 80),
    title: text(root.title, "brief.title", 120),
    date: text(root.date, "brief.date", 120),
    dateIso,
    sources: text(root.sources, "brief.sources", LONG, false),
    status: text(root.status, "brief.status", LONG, false),
    catatanStatus: text(root.catatanStatus, "brief.catatanStatus", LONG, false),
    untuk: text(root.untuk, "brief.untuk", 200),
    disiapkanOleh: text(root.disiapkanOleh, "brief.disiapkanOleh", 200),
    nomorVersi: text(root.nomorVersi, "brief.nomorVersi", 80),
    schedule: section(root.schedule, "brief.schedule", ["headerRight", "items", "catatan"], (entries) => ({
      headerRight: text(entries.headerRight, "brief.schedule.headerRight", 80, false),
      items: list(entries.items, "brief.schedule.items", scheduleEntry),
      catatan: text(entries.catatan, "brief.schedule.catatan", LONG, false),
    })),
    serviceSummary: section(root.serviceSummary, "brief.serviceSummary", ["dateLabel", "sourceLabel", "content", "catatan", "items"], (entries) => {
      const items = entries.items === undefined ? undefined : list(entries.items, "brief.serviceSummary.items", serviceIndicator);
      return {
        dateLabel: text(entries.dateLabel, "brief.serviceSummary.dateLabel", 80),
        sourceLabel: text(entries.sourceLabel, "brief.serviceSummary.sourceLabel", 80, false),
        content: text(entries.content, "brief.serviceSummary.content", LONG),
        catatan: text(entries.catatan, "brief.serviceSummary.catatan", LONG, false),
        ...(items === undefined ? {} : { items }),
      };
    }),
    safetyQuality: section(root.safetyQuality, "brief.safetyQuality", ["headerRight", "exceptions", "catatan", "analisis"], (entries) => ({
      headerRight: text(entries.headerRight, "brief.safetyQuality.headerRight", 80, false),
      exceptions: list(entries.exceptions, "brief.safetyQuality.exceptions", safetyException),
      catatan: text(entries.catatan, "brief.safetyQuality.catatan", LONG, false),
      ...analysis(entries.analisis, "brief.safetyQuality.analisis"),
    })),
    claimsFinance: section(root.claimsFinance, "brief.claimsFinance", ["headerRight", "items", "catatan", "analisis"], (entries) => ({
      headerRight: text(entries.headerRight, "brief.claimsFinance.headerRight", 80, false),
      items: list(entries.items, "brief.claimsFinance.items", claimItem),
      catatan: text(entries.catatan, "brief.claimsFinance.catatan", LONG, false),
      ...analysis(entries.analisis, "brief.claimsFinance.analisis"),
    })),
    staffing: section(root.staffing, "brief.staffing", ["headerRight", "items", "catatan", "analisis"], (entries) => ({
      headerRight: text(entries.headerRight, "brief.staffing.headerRight", 80, false),
      items: list(entries.items, "brief.staffing.items", staffingItem),
      catatan: text(entries.catatan, "brief.staffing.catatan", LONG, false),
      ...analysis(entries.analisis, "brief.staffing.analisis"),
    })),
    systemFindings: section(root.systemFindings, "brief.systemFindings", ["headerRight", "items"], (entries) => ({
      headerRight: text(entries.headerRight, "brief.systemFindings.headerRight", 80, false),
      items: list(entries.items, "brief.systemFindings.items", systemFinding),
    })),
    emailTriage: section(root.emailTriage, "brief.emailTriage", ["headerRight", "data", "unavailableReason"], (entries) => {
      const unavailableReason = entries.unavailableReason === undefined ? undefined : text(entries.unavailableReason, "brief.emailTriage.unavailableReason", LONG);
      if (entries.data === null && unavailableReason === undefined) return fail("brief.emailTriage.unavailableReason");
      return { headerRight: text(entries.headerRight, "brief.emailTriage.headerRight", 80, false), data: entries.data === null ? null : triage(entries.data, "brief.emailTriage.data"), ...(unavailableReason === undefined ? {} : { unavailableReason }) };
    }),
    decisions: section(root.decisions, "brief.decisions", ["headerRight", "items", "catatan"], (entries) => ({
      headerRight: text(entries.headerRight, "brief.decisions.headerRight", 80, false),
      items: list(entries.items, "brief.decisions.items", decisionItem),
      catatan: text(entries.catatan, "brief.decisions.catatan", LONG, false),
    })),
    dataLimitations: section(root.dataLimitations, "brief.dataLimitations", ["headerRight", "items"], (entries) => ({
      headerRight: text(entries.headerRight, "brief.dataLimitations.headerRight", 80, false),
      items: strings(entries.items, "brief.dataLimitations.items"),
    })),
    followUps: section(root.followUps, "brief.followUps", ["headerRight", "items"], (entries) => ({
      headerRight: text(entries.headerRight, "brief.followUps.headerRight", 80, false),
      items: list(entries.items, "brief.followUps.items", followUpItem),
    })),
    conclusion: section(root.conclusion, "brief.conclusion", ["headerRight", "paragraphs", "metadataRule"], (entries) => ({
      headerRight: text(entries.headerRight, "brief.conclusion.headerRight", 80, false),
      paragraphs: strings(entries.paragraphs, "brief.conclusion.paragraphs"),
      metadataRule: text(entries.metadataRule, "brief.conclusion.metadataRule", LONG, false),
    })),
    runningFooter: section(root.runningFooter, "brief.runningFooter", ["docNumber", "notice"], (entries) => ({
      docNumber: text(entries.docNumber, "brief.runningFooter.docNumber", 80),
      notice: text(entries.notice, "brief.runningFooter.notice", 200, false),
    })),
  };
  if (root.systemDoctrine !== undefined) brief.systemDoctrine = text(root.systemDoctrine, "brief.systemDoctrine", 200, false);
  if (root.simrsPulse !== undefined) brief.simrsPulse = simrsPulse(root.simrsPulse, "brief.simrsPulse");
  if (root.publication !== undefined) {
    const publication = record(root.publication, "brief.publication", ["revision", "cutoffAt", "semanticHash", "previousSemanticHash", "sources", "changes"]);
    const semanticHash = text(publication.semanticHash, "brief.publication.semanticHash", 64);
    if (!/^[a-f0-9]{64}$/.test(semanticHash)) return fail("brief.publication.semanticHash");
    const previousSemanticHash = publication.previousSemanticHash === null ? null : text(publication.previousSemanticHash, "brief.publication.previousSemanticHash", 64);
    if (previousSemanticHash !== null && !/^[a-f0-9]{64}$/.test(previousSemanticHash)) return fail("brief.publication.previousSemanticHash");
    brief.publication = { revision: count(publication.revision, "brief.publication.revision"), cutoffAt: text(publication.cutoffAt, "brief.publication.cutoffAt", 40), semanticHash, previousSemanticHash, sources: list(publication.sources, "brief.publication.sources", publicationSource), changes: strings(publication.changes, "brief.publication.changes") };
  }
  if (root.composer !== undefined) brief.composer = composerStamp(root.composer, "brief.composer");
  const codes = brief.decisions.items.map((item) => item.kode);
  if (new Set(codes).size !== codes.length) return fail("brief.decisions.items.kode");
  const numbers = brief.followUps.items.map((item) => item.no);
  if (new Set(numbers).size !== numbers.length) return fail("brief.followUps.items.no");
  return brief;
}
