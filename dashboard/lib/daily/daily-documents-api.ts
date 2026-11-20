import { after } from "next/server";
import { requirePermission } from "../access/access-api";
import { composeAndStoreBrief } from "../composer/run";
import { DirectorApiError, jsonResponse, rateLimit, readBoundedJson, requestKey, requireConfiguration, requireMedifyPublisher, requireSatusehatPublisher } from "../director/director-api";
import { validReportDate } from "../director/director-data";
import { DAILY_DOCUMENT_MAX_BYTES, submitDailyDocument, type DailyDocumentKind, type DailyDocumentReceipt } from "./daily-documents";
import { readMelindaBrief } from "../melinda/melinda-brief-store";
import { parseMedifySnapshot, type MedifySnapshot } from "../medify/medify-snapshot-contract";
import { parseMedifyRunStatus } from "../medify/medify-run-status-contract";
import { parseSatusehatSnapshot } from "../satusehat/satusehat-snapshot-contract";
import { readNewsEdition } from "../news/news-edition-store";
import { PublisherValidationError } from "../publisher-contract";
import { findPatientIdentifiers, identifierLabels, type PatientIdentifier } from "../phi-guard";
import { logError } from "../log";
import { canonicalHash } from "../director/director-store";

/** `?periksa=1`: run the contract and patient-identifier checks, store nothing. */
function checkMode(request: Request): boolean {
  return new URL(request.url).searchParams.get("periksa") === "1";
}
function checkReceipt(kind: DailyDocumentKind, date: string, payload: unknown): Response {
  return jsonResponse({ valid: true, kind, date, payloadHash: canonicalHash(payload) }, 200);
}

/**
 * Best-effort guard: a brief with an obvious patient identifier is refused before it is stored.
 * Every field is checked; the name exemption went with the Puskesmas brief to balowerti-os.
 */
function assertNoPatientIdentifiers(payload: unknown): void {
  const found = new Set<PatientIdentifier>();
  const visit = (value: unknown) => {
    if (typeof value === "string") {
      for (const identifier of findPatientIdentifiers(value)) found.add(identifier);
      return;
    }
    if (Array.isArray(value)) { value.forEach(visit); return; }
    if (!value || typeof value !== "object") return;
    for (const child of Object.values(value)) visit(child);
  };
  visit(payload);
  if (!found.size) return;
  logError("daily_document_phi_blocked", { status: 422 });
  throw new DirectorApiError(422, `Dokumen memuat data pasien (${[...found].map((identifier) => identifierLabels[identifier]).join(", ")}). Hapus lalu kirim ulang.`);
}

/** `GET /api/director/melinda-brief?tanggal=YYYY-MM-DD` — the Director reads the brief the page would show. */
export async function getMelindaBrief(request: Request): Promise<Response> {
  await requirePermission(request, "executive.view");
  const date = new URL(request.url).searchParams.get("tanggal") ?? "";
  if (!validReportDate(date)) throw new DirectorApiError(400, "Tanggal tidak valid.");
  const result = await readMelindaBrief(date);
  return jsonResponse(result, result.status === "missing" ? 404 : 200);
}

function storedReceipt(receipt: DailyDocumentReceipt) {
  return { ...receipt, revisionId: receipt.id, status: "stored" as const };
}

async function submitValidatedDocument(
  request: Request,
  kind: "medify_snapshot" | "medify_run_status" | "satusehat_snapshot",
  bucket: string,
  parse: (value: unknown) => { date: string },
  authenticate: (request: Request) => string = requireMedifyPublisher,
): Promise<Response> {
  const config = requireConfiguration();
  const producerId = authenticate(request);
  await rateLimit(config, `${bucket}:${producerId}`, 30, 60);
  const check = checkMode(request);
  const key = check ? "" : requestKey(request);
  const payload = await readBoundedJson(request, DAILY_DOCUMENT_MAX_BYTES);
  let document;
  try { document = parse(payload); } catch (error) {
    if (error instanceof PublisherValidationError) return jsonResponse({ error: "Format laporan tidak valid.", fields: [error.path] }, 400);
    throw error;
  }
  assertNoPatientIdentifiers(payload);
  if (check) return checkReceipt(kind, document.date, payload);
  const receipt = await submitDailyDocument(config, kind, { producerId, key, date: document.date, payload });
  return jsonResponse(storedReceipt(receipt), receipt.replayed ? 200 : 201);
}

/** `POST /api/director/medify-snapshot` — `scripts/medify-pull.mjs` publishes aggregate Medify counts. */
export async function submitMedifySnapshot(request: Request): Promise<Response> {
  const parsed: { payload?: unknown; snapshot?: MedifySnapshot } = {};
  const response = await submitValidatedDocument(request, "medify_snapshot", "medify-snapshot", (payload) => {
    parsed.payload = payload;
    return (parsed.snapshot = parseMedifySnapshot(payload));
  });
  // 201 is a newly stored snapshot: a replay and a check request both answer 200. The brief is composed after the response.
  // A throw while scheduling or inside the run is logged by code and leaves the response unchanged; a run killed by the platform's time limit logs nothing.
  const { snapshot } = parsed;
  if (response.status === 201 && snapshot) {
    const snapshotHash = canonicalHash(parsed.payload);
    try {
      after(async () => {
        const cfg = requireConfiguration();
        try { await composeAndStoreBrief(cfg, snapshot, snapshotHash); } catch (error) { logError("brief_composer_failed", error); }
        try {
          const { composeNewsEdition } = await import("../news/news-composer");
          const { submitDailyDocument } = await import("./daily-documents");
          const edition = composeNewsEdition({ date: snapshot.date, snapshot, instructions: [] });
          await submitDailyDocument(cfg, "news_edition", {
            producerId: "melinda-news-composer",
            key: `news-${snapshotHash.slice(0, 32)}`,
            date: snapshot.date,
            payload: edition,
          });
        } catch (error) {
          logError("news_composer_failed", error);
        }
      });
    } catch (error) {
      logError("brief_composer_schedule_failed", error);
    }
  }
  return response;
}

/** `POST /api/director/medify-run-status` — safe outcome metadata for one scheduled Medify pull. */
export async function submitMedifyRunStatus(request: Request): Promise<Response> {
  return submitValidatedDocument(request, "medify_run_status", "medify-run-status", parseMedifyRunStatus);
}

/** `POST /api/director/satusehat-snapshot` — `scripts/satusehat-pull.mjs` publishes aggregate OAuth2 counts. */
export async function submitSatusehatSnapshot(request: Request): Promise<Response> {
  return submitValidatedDocument(
    request,
    "satusehat_snapshot",
    "satusehat-snapshot",
    parseSatusehatSnapshot,
    requireSatusehatPublisher,
  );
}

/** `GET /api/director/news-edition?tanggal=YYYY-MM-DD` — the Director reads the stored edition for that date. */
export async function getNewsEdition(request: Request): Promise<Response> {
  await requirePermission(request, "executive.view");
  const date = new URL(request.url).searchParams.get("tanggal") ?? "";
  if (!validReportDate(date)) throw new DirectorApiError(400, "Tanggal tidak valid.");
  const result = await readNewsEdition(date);
  return jsonResponse(result, result.status === "missing" ? 404 : 200);
}
