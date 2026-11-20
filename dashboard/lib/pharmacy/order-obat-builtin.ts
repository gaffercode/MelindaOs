import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { readOrderSheet, type OrderReading } from "./order-obat-reading";
import { extractPdfTextRows } from "../pdf-text";

/** Submission sheets that ship with the dashboard (byte copies of the canonical PDFs under
 * knowledge/01_HOSPITAL/farmasi/pengadaan). The system reads them exactly like an upload: nothing is transcribed by hand. */
export type BuiltInOrderFile = { id: string; fileName: string; receivedAt: string; note: string };

export const BUILT_IN_ORDER_FILES: readonly BuiltInOrderFile[] = [
  { id: "november-2026-b", fileName: "2026-11-03-pengajuan-order-obat-november-b.pdf", receivedAt: "2026-11-09T00:00:00+07:00", note: "Lembar kedua, diterima Direktur 9 November 2026. Nama asli: PENGAJUAN ORDER OBAT.xlsx - Sheet1.pdf." },
  { id: "november-2026", fileName: "2026-11-03-pengajuan-order-obat-november.pdf", receivedAt: "2026-11-05T00:00:00+07:00", note: "Pengajuan 03 November 2026, diserahkan ke Aegis 5 November 2026." },
];

export type BuiltInOrder = { file: BuiltInOrderFile; byteSize: number; reading: OrderReading | null };

const cache = new Map<string, Promise<BuiltInOrder>>();

export function builtInOrderFile(id: string): BuiltInOrderFile | null {
  return BUILT_IN_ORDER_FILES.find((file) => file.id === id) ?? null;
}

export function readBuiltInPdf(file: BuiltInOrderFile): Promise<Buffer> {
  return readFile(join(process.cwd(), "data", "pharmacy-orders", file.fileName));
}

/** The reading is cached per process: the bytes never change while the server runs. */
export function readBuiltInOrder(file: BuiltInOrderFile): Promise<BuiltInOrder> {
  let pending = cache.get(file.id);
  if (!pending) {
    pending = (async () => {
      const bytes = await readBuiltInPdf(file);
      const rows = await extractPdfTextRows(new Uint8Array(bytes));
      const pages = rows.reduce((max, row) => Math.max(max, row.page), 0);
      return { file, byteSize: bytes.byteLength, reading: readOrderSheet(rows, pages) };
    })();
    pending.catch(() => cache.delete(file.id));
    cache.set(file.id, pending);
  }
  return pending;
}

export function listBuiltInOrders(): Promise<BuiltInOrder[]> {
  return Promise.all(BUILT_IN_ORDER_FILES.map(readBuiltInOrder));
}
