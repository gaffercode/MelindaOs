import type { PdfTextRow } from "../pdf-text";

/** What the system reads out of a "Pengajuan order obat" sheet. Printed figures stay as printed; nothing is corrected. */
export type ReadLine = {
  name: string;
  quantity: number | null;
  unit: string;
  unitPricePrinted: string;
  unitPrice: number | null;
  printedLineTotal: number | null;
};
export type ReadSection = { number: number; distributor: string; lines: ReadLine[]; printedTotal: number | null };
export type SignOffLine = { caption: string; name: string };
export type OrderReading = {
  format: "pengajuan-order-obat";
  title: string | null;
  datePrinted: string | null;
  sections: ReadSection[];
  printedGrandTotal: number | null;
  signOff: SignOffLine[];
  references: { sp: string | null; invoice: string | null; approvalMark: string | null };
  pages: number;
};

export type LineGap = { sectionNumber: number; distributor: string; lineName: string; quantity: number; unitPrice: number; product: number; printedLineTotal: number; difference: number };
export type SectionGap = { sectionNumber: number; distributor: string; sumOfPrintedLineTotals: number; printedSectionTotal: number; difference: number };
export type IncompleteLine = { sectionNumber: number; distributor: string; lineName: string; missing: string[] };

/** Deterministic checks over a reading. "menunggu" and "tidak terbaca" are findings, never defaults typed by hand. */
export type OrderChecks = {
  lineCount: number;
  lineGaps: LineGap[];
  sectionGaps: SectionGap[];
  sectionsWithoutTotal: string[];
  grand: { printedGrandTotal: number | null; sumOfPrintedSectionTotals: number; difference: number | null; matchingSection: ReadSection | null };
  incompleteLines: IncompleteLine[];
  linesWithoutUnit: number;
  spNumber: { status: "ada" | "tidak-ada"; reference: string | null };
  invoice: { status: "ada" | "tidak-ada"; reference: string | null };
  signOff: { status: "tercetak" | "tidak-ada"; lines: SignOffLine[]; director: SignOffLine | null; pharmacy: SignOffLine | null };
  approvalMark: { status: "ada" | "tidak-ada"; reference: string | null };
};

const HEADER_TOKENS = ["NO", "NAMA BARANG", "JML", "SATUAN", "HARGA", "DISTRIBUTOR"] as const;
type Columns = { distributor: number; name: number; quantity: number; unit: number; price: number; lineTotal: number };

function parseAmount(text: string): number | null {
  const cleaned = text.replace(/[\s-]+$/g, "").replace(/^[\s-]+/g, "").trim();
  if (!/^\d{1,3}(\.\d{3})+$|^\d+$/.test(cleaned)) return null;
  return Number(cleaned.replace(/\./g, ""));
}

function rowText(row: PdfTextRow): string {
  return row.cells.map((cell) => cell.text).join(" ");
}

/** Column boundaries from the header rows: each cell belongs to the column whose header is nearest on its right. */
function detectColumns(rows: PdfTextRow[]): { columns: Columns; headerEnd: number } | null {
  const anchors: Partial<Record<(typeof HEADER_TOKENS)[number], number>> = {};
  let headerEnd = -1;
  let lineTotalX: number | null = null;
  for (let index = 0; index < Math.min(rows.length, 12); index++) {
    for (const cell of rows[index].cells) {
      const upper = cell.text.toUpperCase();
      for (const token of HEADER_TOKENS) if (upper === token && anchors[token] === undefined) anchors[token] = cell.x;
      if ((upper === "TOTAL HARGA" || upper === "JUMLAH" || upper === "JUMLAH HARGA") && lineTotalX === null) lineTotalX = cell.x;
    }
    if (anchors.SATUAN !== undefined && anchors.JML !== undefined) { headerEnd = index; break; }
  }
  if (headerEnd < 0 || anchors["NAMA BARANG"] === undefined || anchors.HARGA === undefined || lineTotalX === null) return null;
  const distributorX = anchors.DISTRIBUTOR ?? (anchors.NO ?? 0) + 40;
  const mid = (a: number, b: number) => (a + b) / 2;
  return {
    headerEnd,
    columns: {
      distributor: mid(anchors.NO ?? 0, distributorX),
      name: mid(distributorX, anchors["NAMA BARANG"]),
      quantity: mid(anchors["NAMA BARANG"], anchors.JML!),
      unit: mid(anchors.JML!, anchors.SATUAN!),
      price: mid(anchors.SATUAN!, anchors.HARGA),
      lineTotal: mid(anchors.HARGA, lineTotalX),
    },
  };
}

type Slots = { no: string; distributor: string; name: string; quantity: string; unit: string; price: string; lineTotal: string; beyond: string };

function slot(row: PdfTextRow, columns: Columns): Slots {
  const slots: Slots = { no: "", distributor: "", name: "", quantity: "", unit: "", price: "", lineTotal: "", beyond: "" };
  const put = (key: keyof Slots, text: string) => { slots[key] = slots[key] ? `${slots[key]} ${text}` : text; };
  for (const cell of row.cells) {
    if (cell.x < columns.distributor) put("no", cell.text);
    else if (cell.x < columns.name) put("distributor", cell.text);
    else if (cell.x < columns.quantity) put("name", cell.text);
    else if (cell.x < columns.unit) put("quantity", cell.text);
    else if (cell.x < columns.price) put("unit", cell.text);
    else if (cell.x < columns.lineTotal) put("price", cell.text);
    else put(cell.text.toUpperCase().includes("TOTAL") || slots.lineTotal ? "beyond" : "lineTotal", cell.text);
  }
  return slots;
}

function cleanName(text: string): string {
  return text.replace(/^[-–•\s]+/, "").replace(/\s+/g, " ").trim();
}

function findReference(text: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match[0].trim().slice(0, 80);
  }
  return null;
}

/** Reads one sheet from its positioned text rows. Returns null when the sheet has no recognisable header. */
export function readOrderSheet(rows: PdfTextRow[], pages: number): OrderReading | null {
  const detected = detectColumns(rows);
  if (!detected) return null;
  const { columns, headerEnd } = detected;
  const reading: OrderReading = { format: "pengajuan-order-obat", title: null, datePrinted: null, sections: [], printedGrandTotal: null, signOff: [], references: { sp: null, invoice: null, approvalMark: null }, pages };
  for (const row of rows.slice(0, headerEnd)) {
    const text = rowText(row);
    if (!reading.title && /PENGAJUAN/i.test(text)) reading.title = text;
    const date = text.match(/TGL\s*:?\s*(.+)$/i);
    if (date && !reading.datePrinted) reading.datePrinted = date[1].trim();
  }
  let section: ReadSection | null = null;
  const trailing: PdfTextRow[] = [];
  for (const row of rows.slice(headerEnd + 1)) {
    const text = rowText(row);
    const upper = text.toUpperCase();
    if (/TOTAL\s*(ALL|KESELURUHAN|AKHIR)|GRAND\s*TOTAL/.test(upper)) {
      reading.printedGrandTotal = parseAmount(row.cells[row.cells.length - 1].text);
      section = null;
      continue;
    }
    const slots = slot(row, columns);
    const isSectionTotal = /^TOTAL$/i.test(slots.lineTotal.trim()) || /^TOTAL$/i.test(slots.price.trim()) || /^TOTAL$/i.test(slots.beyond.trim().split(" ")[0] ?? "");
    const sectionNumber = /^\d{1,3}$/.test(slots.no.trim()) ? Number(slots.no.trim()) : null;
    if (sectionNumber !== null) {
      section = { number: sectionNumber, distributor: slots.distributor.trim(), lines: [], printedTotal: null };
      reading.sections.push(section);
    }
    if (!section) {
      if (reading.sections.length === 0) continue;
      // A bare number after the last section is the unlabelled grand total only when it is at least as large as
      // every section total read so far; a page number or stray figure stays out of the reading.
      const bareAmount = row.cells.length === 1 ? parseAmount(row.cells[0].text) : null;
      const largestSectionTotal = reading.sections.reduce((max, item) => Math.max(max, item.printedTotal ?? 0), 0);
      if (bareAmount !== null && reading.printedGrandTotal === null && bareAmount >= largestSectionTotal && bareAmount > 0) { reading.printedGrandTotal = bareAmount; continue; }
      trailing.push(row);
      continue;
    }
    const name = cleanName(slots.name);
    const quantity = /^\d+$/.test(slots.quantity.trim()) ? Number(slots.quantity.trim()) : null;
    const pricePrinted = isSectionTotal ? "" : slots.price.replace(/(^|\s)-(\s|$)/g, " ").replace(/-$/, "").trim();
    const lineTotalText = isSectionTotal ? "" : slots.lineTotal;
    if (isSectionTotal) {
      if (name) section.lines.push({ name, quantity, unit: slots.unit.trim(), unitPricePrinted: "", unitPrice: null, printedLineTotal: null });
      section.printedTotal = parseAmount(slots.beyond.replace(/TOTAL/i, "")) ?? parseAmount(slots.lineTotal.replace(/TOTAL/i, ""));
      section = null;
      continue;
    }
    if (!name && quantity === null && !pricePrinted && !lineTotalText) continue;
    if (!name && section.lines.length > 0) {
      const previous = section.lines[section.lines.length - 1];
      if (previous.quantity === null && quantity !== null) previous.quantity = quantity;
      if (!previous.unit && slots.unit) previous.unit = slots.unit.trim();
      if (!previous.unitPricePrinted && pricePrinted) { previous.unitPricePrinted = pricePrinted; previous.unitPrice = parseAmount(pricePrinted); }
      if (previous.printedLineTotal === null && lineTotalText) previous.printedLineTotal = parseAmount(lineTotalText);
      continue;
    }
    section.lines.push({ name, quantity, unit: slots.unit.trim(), unitPricePrinted: pricePrinted, unitPrice: pricePrinted ? parseAmount(pricePrinted) : null, printedLineTotal: lineTotalText ? parseAmount(lineTotalText) : null });
  }
  reading.signOff = readSignOff(trailing);
  const fullText = rows.map(rowText).join("\n");
  reading.references = {
    sp: findReference(fullText, [/\b(?:no\.?|nomor)\s*SP\b[^\n]{0,40}/i, /\bsurat\s+pesanan\b[^\n]{0,40}/i, /\bSP[\s./-]*\d[^\n]{0,30}/]),
    invoice: findReference(fullText, [/\bfaktur\b[^\n]{0,40}/i, /\binvoice\b[^\n]{0,40}/i]),
    approvalMark: findReference(fullText, [/\bdisetujui\b[^\n]{0,40}/i, /\bapproved\b[^\n]{0,40}/i, /\bACC\b[^\n]{0,40}/]),
  };
  return reading;
}

export const GRID_MAX_ROWS = 5000;
export const GRID_MAX_COLUMNS = 60;

/** A numeric spreadsheet cell as the sheet would print it: whole values without fraction or exponent, a value within
 * 1e-6 of a whole number (formula noise such as 234765.00000000003) as that whole number, any other fraction with a
 * comma and never rounded. A negative value is written in brackets, so it is reported as not read instead of
 * losing its sign. Anything that is not plain decimal or scientific notation comes back as given. */
export function formatSheetNumber(raw: string): string {
  if (!/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(raw)) return raw;
  const value = Number(raw);
  if (!Number.isFinite(value)) return raw;
  const nearest = Math.round(value);
  const whole = Math.abs(value - nearest) < 1e-6;
  const written = whole && Math.abs(value) < 1e21 ? String(Math.abs(nearest)) : (!whole && /[eE]/.test(raw) ? String(value) : raw).replace(".", ",").replace(/^-/, "");
  return value < 0 ? `(${written})` : written;
}

/** Spreadsheet cells as positioned text rows, so a grid goes through the same reader as a PDF: page 1, y is the
 * row index, x is the column index times 100. Cell text is trimmed and empty cells are left out. */
export function gridToRows(grid: string[][]): PdfTextRow[] {
  return grid.slice(0, GRID_MAX_ROWS).map((row, y) => ({
    page: 1,
    y,
    cells: row.slice(0, GRID_MAX_COLUMNS).flatMap((text, column) => {
      const trimmed = text.trim();
      return trimmed ? [{ x: column * 100, text: trimmed }] : [];
    }),
  }));
}

export function readOrderGrid(grid: string[][]): OrderReading | null {
  return readOrderSheet(gridToRows(grid), 1);
}

/** Caption rows end with a comma ("Kepala Unit Farmasi,"); the name is the next non-caption text on the same side. */
function readSignOff(rows: PdfTextRow[]): SignOffLine[] {
  const sides: Array<{ captions: string[]; names: string[] }> = [{ captions: [], names: [] }, { captions: [], names: [] }];
  let min = Infinity;
  let max = -Infinity;
  for (const row of rows) for (const cell of row.cells) { min = Math.min(min, cell.x); max = Math.max(max, cell.x); }
  if (min === Infinity) return [];
  const split = (min + max) / 2;
  for (const row of rows) {
    for (const cell of row.cells) {
      const side = sides[cell.x < split ? 0 : 1];
      if (/,$/.test(cell.text) || /^(Mengetahui|Menyetujui|Dibuat|Diperiksa|Direktur|Kepala|Manajer|Ketua)\b/i.test(cell.text)) side.captions.push(cell.text.replace(/,$/, ""));
      else if (/[A-Za-z]/.test(cell.text) && !/^\d/.test(cell.text)) side.names.push(cell.text);
    }
  }
  return sides.flatMap((side) => (side.captions.length || side.names.length ? [{ caption: side.captions.join(", "), name: side.names.join(" ") }] : []));
}

export function checkOrderReading(reading: OrderReading): OrderChecks {
  const lineGaps: LineGap[] = [];
  const sectionGaps: SectionGap[] = [];
  const incompleteLines: IncompleteLine[] = [];
  const sectionsWithoutTotal: string[] = [];
  let lineCount = 0;
  let linesWithoutUnit = 0;
  for (const section of reading.sections) {
    let sum = 0;
    for (const line of section.lines) {
      lineCount++;
      if (!line.unit) linesWithoutUnit++;
      const missing = [line.quantity === null ? "jumlah" : "", line.unitPrice === null ? "harga satuan" : "", line.printedLineTotal === null ? "total baris" : ""].filter(Boolean);
      if (missing.length) { incompleteLines.push({ sectionNumber: section.number, distributor: section.distributor, lineName: line.name, missing }); continue; }
      const product = line.quantity! * line.unitPrice!;
      sum += line.printedLineTotal!;
      if (product !== line.printedLineTotal) {
        lineGaps.push({ sectionNumber: section.number, distributor: section.distributor, lineName: line.name, quantity: line.quantity!, unitPrice: line.unitPrice!, product, printedLineTotal: line.printedLineTotal!, difference: line.printedLineTotal! - product });
      }
    }
    if (section.printedTotal === null) sectionsWithoutTotal.push(section.distributor);
    else if (sum !== section.printedTotal) sectionGaps.push({ sectionNumber: section.number, distributor: section.distributor, sumOfPrintedLineTotals: sum, printedSectionTotal: section.printedTotal, difference: sum - section.printedTotal });
  }
  const sumOfPrintedSectionTotals = reading.sections.reduce((total, section) => total + (section.printedTotal ?? 0), 0);
  const difference = reading.printedGrandTotal === null ? null : sumOfPrintedSectionTotals - reading.printedGrandTotal;
  const matchingSection = difference ? reading.sections.find((section) => section.printedTotal === difference) ?? null : null;
  const director = reading.signOff.find((line) => /direktur/i.test(line.caption)) ?? null;
  const pharmacy = reading.signOff.find((line) => /farmasi/i.test(line.caption)) ?? null;
  return {
    lineCount,
    lineGaps,
    sectionGaps,
    sectionsWithoutTotal,
    grand: { printedGrandTotal: reading.printedGrandTotal, sumOfPrintedSectionTotals, difference, matchingSection },
    incompleteLines,
    linesWithoutUnit,
    spNumber: { status: reading.references.sp ? "ada" : "tidak-ada", reference: reading.references.sp },
    invoice: { status: reading.references.invoice ? "ada" : "tidak-ada", reference: reading.references.invoice },
    signOff: { status: reading.signOff.length ? "tercetak" : "tidak-ada", lines: reading.signOff, director, pharmacy },
    approvalMark: { status: reading.references.approvalMark ? "ada" : "tidak-ada", reference: reading.references.approvalMark },
  };
}

export function filterReadSections(sections: ReadSection[], query: string): ReadSection[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return sections;
  return sections.flatMap((section) => {
    const distributorMatches = section.distributor.toLowerCase().includes(needle) || String(section.number) === needle;
    const lines = distributorMatches ? section.lines : section.lines.filter((line) => `${line.name} ${line.unit}`.toLowerCase().includes(needle));
    return lines.length ? [{ ...section, lines }] : [];
  });
}
