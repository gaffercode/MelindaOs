import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseFormularium, type FormulariumReading } from "./formularium";
import { readXlsx } from "../xlsx-read";

/** The workbook that ships with the dashboard (byte copy of knowledge/01_HOSPITAL/farmasi/formularium). The system reads it
 * on the server; the reading is cached per process because the bytes never change while the server runs. */
export const FORMULARIUM_FILE = "2026-10-27_formularium-DPJP-rapi.xlsx";

export type FormulariumSource = { fileName: string; byteSize: number; reading: FormulariumReading };

let cached: Promise<FormulariumSource> | null = null;

export function readFormulariumSource(): Promise<FormulariumSource> {
  if (!cached) {
    cached = (async () => {
      const bytes = await readFile(join(process.cwd(), "data", "formularium", FORMULARIUM_FILE));
      return { fileName: FORMULARIUM_FILE, byteSize: bytes.byteLength, reading: parseFormularium(readXlsx(new Uint8Array(bytes))) };
    })();
    cached.catch(() => { cached = null; });
  }
  return cached;
}
