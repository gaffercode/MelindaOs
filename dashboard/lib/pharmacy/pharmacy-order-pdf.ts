import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Byte copy of the canonical PDF, kept inside the dashboard project so the production build can serve it. */
export const PHARMACY_ORDER_PDF_PATH = join(process.cwd(), "data", "pharmacy-orders", "2026-11-03-pengajuan-order-obat-november.pdf");

export function readPharmacyOrderPdf(): Buffer {
  return readFileSync(PHARMACY_ORDER_PDF_PATH);
}
