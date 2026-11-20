import type { XlsxSheet } from "../xlsx-read";

/** What the system reads out of the DPJP formularium workbook. A sheet is recognised by its header row, not by its
 * name or position; the lists, counts and numbering findings all come from the cells. Nothing is verified against
 * an official preparation list here, and nothing is a therapy recommendation. */
export type FormulariumKind = "daftar" | "usulan" | "regimen";
export type FormulariumTable = {
  id: string;
  sheet: string;
  kind: FormulariumKind;
  columns: string[];
  rows: string[][];
  /** Row indexes the workbook itself marks "Perlu konfirmasi" (or holds back for review). */
  flaggedRows: number[];
};
export type FormulariumReading = { notes: string[]; tables: FormulariumTable[] };

export type NumberingFindings = { missing: number[]; duplicated: number[]; unnumbered: number };
export type FormulariumChecks = {
  id: string;
  rowCount: number;
  flagged: number;
  marked: number;
  crossed: number;
  unmarked: number;
  numbering: NumberingFindings | null;
};

const LIST_COLUMNS = ["No (sumber)", "Nama obat/item (seperti tertulis)", "Kategori", "Status tanda", "Catatan pada sumber"] as const;

function slug(text: string): string {
  return text.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function column(header: string[], title: string): number {
  return header.findIndex((cell) => cell.toLowerCase() === title.toLowerCase());
}

function dataRows(sheet: XlsxSheet): string[][] {
  return sheet.rows.slice(1).filter((row) => row.some((cell) => cell !== ""));
}

/** The text lines of the summary sheet: rows with a single filled cell (title, source, caveats). */
function noteLines(sheet: XlsxSheet): string[] {
  return sheet.rows.flatMap((row) => {
    const filled = row.filter((cell) => cell !== "");
    return filled.length === 1 ? filled : [];
  });
}

export function parseFormularium(sheets: XlsxSheet[]): FormulariumReading {
  const notes: string[] = [];
  const tables: FormulariumTable[] = [];
  for (const sheet of sheets) {
    const header = sheet.rows[0] ?? [];
    if (sheet.rows.some((row) => row[0] === "Bagian" && row[1] === "Jumlah baris")) {
      notes.push(...noteLines(sheet));
      continue;
    }
    const id = slug(sheet.name);
    const titled = header.filter((cell) => cell !== "");
    if (header[0] === "No (sumber)" && column(header, "Nama obat/item (seperti tertulis)") >= 0) {
      const picks = LIST_COLUMNS.map((title) => column(header, title));
      const confirm = column(header, "Perlu konfirmasi");
      const rows = dataRows(sheet);
      tables.push({
        id, sheet: sheet.name, kind: "daftar", columns: [...LIST_COLUMNS],
        rows: rows.map((row) => picks.map((index) => (index >= 0 ? row[index] ?? "" : ""))),
        flaggedRows: rows.flatMap((row, index) => (confirm >= 0 && (row[confirm] ?? "") !== "" ? [index] : [])),
      });
    } else if (column(header, "Nama dagang") >= 0) {
      tables.push({ id, sheet: sheet.name, kind: "usulan", columns: titled, rows: dataRows(sheet).map((row) => titled.map((_, index) => row[index] ?? "")), flaggedRows: [] });
    } else if (header[0] === "Kelompok" && column(header, "Item (seperti terkirim)") >= 0) {
      const note = column(header, "Catatan");
      const rows = dataRows(sheet);
      tables.push({ id, sheet: sheet.name, kind: "regimen", columns: titled, rows: rows.map((row) => titled.map((_, index) => row[index] ?? "")), flaggedRows: rows.flatMap((row, index) => (note >= 0 && /ditahan/i.test(row[note] ?? "") ? [index] : [])) });
    }
  }
  return { notes, tables };
}

/** Counts and numbering findings computed from the cells of one table. */
export function checkFormularium(table: FormulariumTable): FormulariumChecks {
  const status = table.columns.indexOf("Status tanda");
  let marked = 0;
  let crossed = 0;
  let unmarked = 0;
  if (status >= 0) {
    for (const row of table.rows) {
      if (row[status].includes("✓")) marked++;
      else if (row[status].includes("✗")) crossed++;
      else if (/tanpa tanda/i.test(row[status])) unmarked++;
    }
  }
  let numbering: NumberingFindings | null = null;
  if (table.kind === "daftar") {
    const seen = new Map<number, number>();
    let unnumbered = 0;
    for (const row of table.rows) {
      const number = Number(row[0]);
      if (row[0] !== "" && Number.isInteger(number)) seen.set(number, (seen.get(number) ?? 0) + 1);
      else unnumbered++;
    }
    const numbers = [...seen.keys()].sort((a, b) => a - b);
    const missing: number[] = [];
    for (let value = numbers[0] ?? 1; value <= (numbers[numbers.length - 1] ?? 0); value++) if (!seen.has(value)) missing.push(value);
    numbering = { missing, duplicated: numbers.filter((value) => (seen.get(value) ?? 0) > 1), unnumbered };
  }
  return { id: table.id, rowCount: table.rows.length, flagged: table.flaggedRows.length, marked, crossed, unmarked, numbering };
}

/** Rows the DPJP struck out (✗ in the status column): not in use, so not part of the list that is shown. */
export function crossedRows(table: FormulariumTable): Set<number> {
  const status = table.columns.indexOf("Status tanda");
  const crossed = new Set<number>();
  if (status >= 0) table.rows.forEach((row, index) => { if (row[status].includes("✗")) crossed.add(index); });
  return crossed;
}

/** "4, 47-49" style list of whole numbers. */
export function formatNumberRanges(values: number[]): string {
  const parts: string[] = [];
  for (let index = 0; index < values.length; index++) {
    let end = index;
    while (end + 1 < values.length && values[end + 1] === values[end] + 1) end++;
    parts.push(end > index ? `${values[index]}-${values[end]}` : String(values[index]));
    index = end;
  }
  return parts.join(", ");
}

export function filterFormulariumRows(table: FormulariumTable, query: string): number[] {
  const needle = query.trim().toLowerCase();
  const all = table.rows.map((_, index) => index);
  if (!needle) return all;
  return all.filter((index) => table.rows[index].some((cell) => cell.toLowerCase().includes(needle)));
}
