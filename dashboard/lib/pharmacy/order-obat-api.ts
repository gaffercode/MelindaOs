import { createHash } from "node:crypto";
import { parseCsv, type CsvTable } from "../csv";
import { requirePermission } from "../access/access-api";
import { DirectorApiError, jsonResponse } from "../director/director-api";
import type { DirectorAuthConfiguration } from "../director/director-auth";
import { DirectorStoreError } from "../director/director-store";
import { logError } from "../log";
import { BUILT_IN_ORDER_FILES, builtInOrderFile, listBuiltInOrders, readBuiltInOrder, readBuiltInPdf, type BuiltInOrder } from "./order-obat-builtin";
import { formatSheetNumber, GRID_MAX_COLUMNS, GRID_MAX_ROWS, readOrderGrid, readOrderSheet, type OrderReading } from "./order-obat-reading";
import { deleteObject, detectKind, objectPath, ORDER_OBAT_MAX_BYTES, signedObjectUrl, storageConfiguration, uploadObject, type OrderFileKind } from "./order-obat-storage";
import { extractPdfTextRows } from "../pdf-text";
import { readXlsx } from "../xlsx-read";

/** What the system read out of a file: a CSV table, or a recognised "Pengajuan order obat" sheet. */
export type ParsedContent = { format: "csv"; table: CsvTable } | OrderReading;
export type OrderDecisionValue = "diterima" | "ditolak";
export type OrderDecision = { orderKey: string; decision: OrderDecisionValue; note: string | null; decidedBy: string; decidedAt: string };

export type OrderFile = {
  key: string;
  source: "builtin" | "upload";
  id: string;
  uploadedAt: string;
  uploadedBy: string;
  fileName: string;
  contentType: string;
  byteSize: number;
  kind: OrderFileKind;
  note: string | null;
  parsedFormat: ParsedContent["format"] | null;
};
export type OrderFileDetail = { order: OrderFile; parsed: ParsedContent | null };
export type OrderQueue = { orders: Pick<OrderFile, "key" | "fileName" | "uploadedAt">[]; decisions: Record<string, OrderDecision> };
export type OrderFileList = { orders: OrderFile[]; decisions: Record<string, OrderDecision>; uploads: boolean; storeNotice: string | null };

type StoredOrder = { id: number; uploadedAt: string; uploadedBy: string; fileName: string; contentType: string; byteSize: number; sha256: string; storagePath: string; kind: OrderFileKind; parsed: ParsedContent | null; note: string | null };
type StoredListRow = Omit<StoredOrder, "parsed" | "storagePath"> & { parsedFormat: ParsedContent["format"] | null };
type Stored = { order: StoredOrder; replayed: boolean };

const rpc = "melinda_pharmacy_orders";
const CONTENT_TYPES: Record<OrderFileKind, string> = {
  csv: "text/csv",
  pdf: "application/pdf",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  other: "application/octet-stream",
};

function builtInFile(order: BuiltInOrder): OrderFile {
  return { key: `builtin:${order.file.id}`, source: "builtin", id: order.file.id, uploadedAt: order.file.receivedAt, uploadedBy: "direktur", fileName: order.file.fileName, contentType: "application/pdf", byteSize: order.byteSize, kind: "pdf", note: order.file.note, parsedFormat: order.reading ? order.reading.format : null };
}

function uploadedFile(row: StoredListRow | StoredOrder): OrderFile {
  const parsedFormat = "parsed" in row ? row.parsed?.format ?? null : row.parsedFormat;
  return { key: `upload:${row.id}`, source: "upload", id: String(row.id), uploadedAt: row.uploadedAt, uploadedBy: row.uploadedBy, fileName: row.fileName, contentType: row.contentType, byteSize: row.byteSize, kind: row.kind, note: row.note, parsedFormat };
}

function uploadId(value: string): number {
  if (!/^\d{1,12}$/.test(value)) throw new DirectorApiError(404, "Berkas tidak ditemukan.");
  return Number(value);
}

function noteText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value !== "string") throw new DirectorApiError(400, "Catatan tidak valid.");
  const trimmed = value.trim();
  if (trimmed.length > 280 || /[\u0000-\u001f\u007f]/.test(trimmed)) throw new DirectorApiError(400, "Catatan tidak valid.");
  return trimmed;
}

/** Reads the sheet out of PDF bytes; a scan or an unrelated PDF yields null and is kept as-is. */
async function readPdfContent(bytes: Uint8Array): Promise<OrderReading | null> {
  try {
    const rows = await extractPdfTextRows(bytes);
    return readOrderSheet(rows, rows.reduce((max, row) => Math.max(max, row.page), 0));
  } catch (error) {
    logError("order_obat_pdf_read", error);
    return null;
  }
}

/** Reads the first sheet of a workbook that holds an order sheet; an unrelated or broken workbook yields null and is kept as-is. */
function readSpreadsheetContent(bytes: Uint8Array): OrderReading | null {
  try {
    for (const sheet of readXlsx(bytes, { formatNumber: formatSheetNumber, maxRows: GRID_MAX_ROWS, maxColumns: GRID_MAX_COLUMNS, maxSheets: 20 })) {
      const reading = readOrderGrid(sheet.rows);
      if (reading) return reading;
    }
    return null;
  } catch (error) {
    logError("order_obat_xlsx_read", error);
    return null;
  }
}

/** Reads a CSV written from an order sheet; any other CSV, or one the reader fails on, is kept as a plain table. */
function readCsvContent(table: CsvTable): ParsedContent {
  try {
    return readOrderGrid([table.header, ...table.rows]) ?? { format: "csv", table };
  } catch (error) {
    logError("order_obat_csv_read", error);
    return { format: "csv", table };
  }
}

/** The sheets that ship with the dashboard, read on the server for the page's first paint. */
export async function builtInInitialFiles(): Promise<OrderFileDetail[]> {
  return (await listBuiltInOrders()).map((order) => ({ order: builtInFile(order), parsed: order.reading }));
}

export async function listOrderFiles(request: Request): Promise<Response> {
  const { config } = await requirePermission(request, "pharmacy.view");
  return jsonResponse(await readOrderFileList(config));
}

/** Names, dates and decisions only: no sheet is opened, so pages outside Order obat need no PDF worker. A store failure throws, because built-ins alone would look undecided. */
export async function readOrderQueue(config: DirectorAuthConfiguration): Promise<OrderQueue> {
  const listed = await config.store.call<{ orders: StoredListRow[]; decisions: Record<string, OrderDecision>; removed?: string[] }>("list", { limit: 100 }, rpc);
  const removed = new Set(listed.removed ?? []);
  const uploads = listed.orders.map((row) => ({ key: `upload:${row.id}`, fileName: row.fileName, uploadedAt: row.uploadedAt }));
  const builtIns = BUILT_IN_ORDER_FILES.map((file) => ({ key: `builtin:${file.id}`, fileName: file.fileName, uploadedAt: file.receivedAt }));
  return { orders: [...uploads, ...builtIns.filter((file) => !removed.has(file.key))], decisions: listed.decisions ?? {} };
}

/** Built-in and uploaded sheets with their decisions; without the store only the built-ins show, with a notice. */
export async function readOrderFileList(config: DirectorAuthConfiguration): Promise<OrderFileList> {
  const builtIns = (await listBuiltInOrders()).map(builtInFile);
  let uploads: OrderFile[] = [];
  let decisions: Record<string, OrderDecision> = {};
  let storeNotice: string | null = null;
  let removed = new Set<string>();
  try {
    const listed = await config.store.call<{ orders: StoredListRow[]; decisions: Record<string, OrderDecision>; removed?: string[] }>("list", { limit: 100 }, rpc);
    uploads = listed.orders.map(uploadedFile);
    decisions = listed.decisions ?? {};
    removed = new Set(listed.removed ?? []);
  } catch (error) {
    if (!(error instanceof DirectorStoreError)) throw error;
    logError("order_obat_list", error);
    storeNotice = "Tabel unggahan dan keputusan belum tersedia di Supabase; hanya berkas bawaan yang tampil.";
  }
  return { orders: [...uploads, ...builtIns.filter((file) => !removed.has(file.key))], decisions, uploads: storageConfiguration() !== null, storeNotice };
}

/** Multipart upload of one CSV, PDF or XLSX: bytes go to the private bucket, metadata (and what the system read) to the RPC. */
export async function uploadOrderFile(request: Request): Promise<Response> {
  const { config, reviewerId } = await requirePermission(request, "pharmacy.upload", true);
  const storage = storageConfiguration();
  if (!storage) throw new DirectorApiError(503, "Penyimpanan berkas belum diaktifkan.");
  const length = Number(request.headers.get("content-length") ?? "0");
  if (length > ORDER_OBAT_MAX_BYTES + 64 * 1024) throw new DirectorApiError(413, "Berkas lebih dari 15 MB.");
  let form: FormData;
  try { form = await request.formData(); } catch { throw new DirectorApiError(400, "Format unggahan tidak valid."); }
  const file = form.get("berkas");
  if (!(file instanceof File)) throw new DirectorApiError(400, "Pilih satu berkas.");
  if (file.size === 0) throw new DirectorApiError(400, "Berkas kosong.");
  if (file.size > ORDER_OBAT_MAX_BYTES) throw new DirectorApiError(413, "Berkas lebih dari 15 MB.");
  const note = noteText(form.get("catatan"));
  const fileName = file.name.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 160) || "berkas";
  const bytes = new Uint8Array(await file.arrayBuffer());
  const kind = detectKind(bytes, fileName);
  if (kind === "other") throw new DirectorApiError(415, "Hanya CSV, PDF, atau XLSX yang diterima.");
  let parsed: ParsedContent | null = null;
  if (kind === "csv") {
    const table = parseCsv(new TextDecoder("utf-8").decode(bytes));
    if (table.header.length === 0) throw new DirectorApiError(400, "CSV tidak punya baris judul.");
    parsed = readCsvContent(table);
  } else if (kind === "pdf") {
    parsed = await readPdfContent(bytes);
  } else if (kind === "xlsx") {
    parsed = readSpreadsheetContent(bytes);
  }
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const storagePath = objectPath(sha256, fileName);
  const contentType = CONTENT_TYPES[kind];
  const args = { uploadedBy: reviewerId, fileName, contentType, byteSize: bytes.byteLength, sha256, storagePath, kind, parsed, note };

  await uploadObject(storagePath, bytes, contentType, storage);
  let stored: Stored;
  try {
    stored = await config.store.call<Stored>("create", args, rpc);
  } catch (error) {
    await deleteObject(storagePath, storage);
    if (error instanceof DirectorStoreError) logError("order_obat_metadata", error);
    throw error;
  }
  const body: OrderFileDetail & { replayed: boolean } = { order: uploadedFile(stored.order), parsed: stored.order.parsed, replayed: stored.replayed };
  return jsonResponse(body, stored.replayed ? 200 : 201);
}

export async function readOrderFile(request: Request, id: string): Promise<Response> {
  const { config } = await requirePermission(request, "pharmacy.view");
  const builtIn = builtInOrderFile(id);
  if (builtIn) {
    const order = await readBuiltInOrder(builtIn);
    const body: OrderFileDetail = { order: builtInFile(order), parsed: order.reading };
    return jsonResponse(body);
  }
  const { order } = await config.store.call<Stored>("read", { id: uploadId(id) }, rpc);
  const body: OrderFileDetail = { order: uploadedFile(order), parsed: order.parsed };
  return jsonResponse(body);
}

/** Built-in sheets stream from the dashboard's data folder; uploads redirect to a short-lived signed URL. */
export async function openOrderFile(request: Request, id: string): Promise<Response> {
  const { config } = await requirePermission(request, "pharmacy.view");
  const builtIn = builtInOrderFile(id);
  if (builtIn) {
    const bytes = await readBuiltInPdf(builtIn);
    return new Response(new Uint8Array(bytes), { status: 200, headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${builtIn.fileName}"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  }
  const storage = storageConfiguration();
  if (!storage) throw new DirectorApiError(503, "Penyimpanan berkas belum diaktifkan.");
  const { order } = await config.store.call<Stored>("read", { id: uploadId(id) }, rpc);
  const download = new URL(request.url).searchParams.get("unduh") === "1" ? order.fileName : undefined;
  const location = await signedObjectUrl(order.storagePath, { ...storage, download });
  return new Response(null, { status: 302, headers: { Location: location, "Cache-Control": "no-store" } });
}

/** The Director accepts or rejects a submission file (null withdraws). A decision about the file, not an order or a payment. */
export async function decideOrderFile(request: Request, id: string): Promise<Response> {
  const { config, reviewerId } = await requirePermission(request, "pharmacy.decide", true);
  let body: unknown;
  try { body = await request.json(); } catch { throw new DirectorApiError(400, "Isi permintaan tidak valid."); }
  if (!body || typeof body !== "object") throw new DirectorApiError(400, "Isi permintaan tidak valid.");
  const { keputusan, catatan } = body as { keputusan?: unknown; catatan?: unknown };
  if (keputusan !== null && keputusan !== "diterima" && keputusan !== "ditolak") throw new DirectorApiError(400, "Keputusan harus diterima, ditolak, atau null.");
  const orderKey = builtInOrderFile(id) ? `builtin:${id}` : `upload:${uploadId(id)}`;
  const result = await config.store.call<{ decision: OrderDecision | null }>("decide", { orderKey, decision: keputusan, note: noteText(catatan), decidedBy: reviewerId }, rpc);
  return jsonResponse({ orderKey, decision: result.decision });
}

/** Removes a submission file: an upload loses its object and row, a built-in sheet is marked removed. The decision goes with it. */
export async function removeOrderFile(request: Request, id: string): Promise<Response> {
  const { config, reviewerId } = await requirePermission(request, "director.only", true);
  const orderKey = builtInOrderFile(id) ? `builtin:${id}` : `upload:${uploadId(id)}`;
  const result = await config.store.call<{ removed: string; storagePath: string | null }>("remove", { orderKey, removedBy: reviewerId }, rpc);
  if (result.storagePath) {
    const storage = storageConfiguration();
    if (storage) {
      try { await deleteObject(result.storagePath, storage); } catch (error) { logError("order_obat_delete_object", error); }
    }
  }
  return jsonResponse({ removed: result.removed });
}
