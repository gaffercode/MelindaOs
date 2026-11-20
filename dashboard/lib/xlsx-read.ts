import { inflateRawSync } from "node:zlib";

/** Minimal read-only .xlsx reader: zip container, shared strings, sheet cells as text. No formulas, styles or
 * merged cells; a cell is the text Excel shows for its stored value. Built for trusted, bundled workbooks. */
export type XlsxSheet = { name: string; rows: string[][] };

const MAX_ENTRY_BYTES = 20 * 1024 * 1024;
const MAX_TOTAL_BYTES = 64 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 2000;
/** Excel's last column is XFD. */
const MAX_COLUMN_COUNT = 16384;
const MAX_SHARED_STRINGS = 200_000;

type ZipEntry = { method: number; compressedSize: number; size: number; dataStart: number };
type Zip = { read: (name: string) => Buffer | null };

/** Indexes the central directory only; an entry is inflated when asked for, against a total budget for the call. */
function openZip(bytes: Uint8Array): Zip {
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let index = buffer.length - 22; index >= Math.max(0, buffer.length - 22 - 65535); index--) {
    if (buffer.readUInt32LE(index) === 0x06054b50) { eocd = index; break; }
  }
  if (eocd < 0) throw new Error("xlsx: bukan berkas zip");
  const entries = buffer.readUInt16LE(eocd + 10);
  if (entries > MAX_ZIP_ENTRIES) throw new Error("xlsx: terlalu banyak entri zip");
  let cursor = buffer.readUInt32LE(eocd + 16);
  const index = new Map<string, ZipEntry>();
  for (let entry = 0; entry < entries; entry++) {
    if (buffer.readUInt32LE(cursor) !== 0x02014b50) throw new Error("xlsx: direktori zip rusak");
    const method = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const size = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const name = buffer.toString("utf8", cursor + 46, cursor + 46 + nameLength);
    cursor += 46 + nameLength + extraLength + commentLength;
    if (name.endsWith("/")) continue;
    if (buffer.readUInt32LE(localOffset) !== 0x04034b50) throw new Error("xlsx: header zip rusak");
    const dataStart = localOffset + 30 + buffer.readUInt16LE(localOffset + 26) + buffer.readUInt16LE(localOffset + 28);
    index.set(name, { method, compressedSize, size, dataStart });
  }
  let inflated = 0;
  return {
    read(name) {
      const entry = index.get(name);
      if (!entry) return null;
      const limit = Math.min(MAX_ENTRY_BYTES, MAX_TOTAL_BYTES - inflated);
      if (entry.size > limit) throw new Error("xlsx: entri terlalu besar");
      const raw = buffer.subarray(entry.dataStart, entry.dataStart + entry.compressedSize);
      let data: Buffer;
      if (entry.method === 0) data = Buffer.from(raw);
      else if (entry.method === 8) {
        try { data = inflateRawSync(raw, { maxOutputLength: limit }); } catch { throw new Error("xlsx: entri tidak dapat dibaca atau terlalu besar"); }
      } else throw new Error(`xlsx: metode kompresi ${entry.method} tidak didukung`);
      if (data.length > limit) throw new Error("xlsx: entri terlalu besar");
      inflated += data.length;
      return data;
    },
  };
}

/** An invalid code point (above U+10FFFF or a surrogate) reads as empty. */
function codePoint(value: number): string {
  return Number.isInteger(value) && value <= 0x10ffff && (value < 0xd800 || value > 0xdfff) ? String.fromCodePoint(value) : "";
}

function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => codePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, digits: string) => codePoint(Number(digits)))
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}

type StartTag = { attrs: string; selfClosing: boolean; end: number };
type Element = { attrs: string; body: string | null };

function isNameChar(code: number): boolean {
  return (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || code === 95;
}

/** The first start tag `<tag ...>` at or after `from`, found with `indexOf`; null when none, or when it has no `>`.
 * `end` is the index just past the tag. */
function startTagFrom(xml: string, tag: string, from: number): StartTag | null {
  const open = `<${tag}`;
  let cursor = from;
  for (;;) {
    const start = xml.indexOf(open, cursor);
    if (start < 0) return null;
    const after = start + open.length;
    if (isNameChar(xml.charCodeAt(after))) { cursor = after; continue; }
    const close = xml.indexOf(">", after);
    if (close < 0) return null;
    const selfClosing = xml.charCodeAt(close - 1) === 47;
    return { attrs: xml.slice(after, selfClosing ? close - 1 : close), selfClosing, end: close + 1 };
  }
}

/** Start tags in order; each byte is examined a bounded number of times. */
function* startTags(xml: string, tag: string): Generator<StartTag> {
  for (let found = startTagFrom(xml, tag, 0); found; found = startTagFrom(xml, tag, found.end)) yield found;
}

/** Elements `<tag ...>body</tag>` or `<tag .../>` (body null) in order, not nested. When a close tag is missing no
 * later one can exist, so the scan stops there. */
function* elements(xml: string, tag: string): Generator<Element> {
  const closeTag = `</${tag}>`;
  for (let found = startTagFrom(xml, tag, 0); found; ) {
    if (found.selfClosing) {
      yield { attrs: found.attrs, body: null };
      found = startTagFrom(xml, tag, found.end);
      continue;
    }
    const close = xml.indexOf(closeTag, found.end);
    if (close < 0) return;
    yield { attrs: found.attrs, body: xml.slice(found.end, close) };
    found = startTagFrom(xml, tag, close + closeTag.length);
  }
}

function textOf(xml: string): string {
  let text = "";
  for (const run of elements(xml, "t")) text += run.body ?? "";
  return decodeEntities(text);
}

/** The stored value of a cell body: the first `<v>` element's text, undefined when there is none. */
function valueOf(body: string): string | undefined {
  for (const value of elements(body, "v")) return value.body ?? undefined;
  return undefined;
}

function columnIndex(reference: string): number {
  let index = 0;
  for (const char of reference.replace(/[^A-Z]/gi, "").toUpperCase()) index = index * 26 + char.charCodeAt(0) - 64;
  return index - 1;
}

function attribute(tag: string, name: string): string | null {
  const match = tag.match(new RegExp(`\\b${name}="([^"]*)"`));
  return match ? decodeEntities(match[1]) : null;
}

export type XlsxReadOptions = { formatNumber?: (raw: string) => string; maxRows?: number; maxColumns?: number; maxSheets?: number };

/** `formatNumber`, when given, is applied to the stored value of numeric cells only (no `t`, or `t="n"`). Rows, columns
 * and sheets beyond the limits are never parsed; a cell past column XFD is always skipped. */
export function readXlsx(bytes: Uint8Array, options: XlsxReadOptions = {}): XlsxSheet[] {
  const { formatNumber, maxRows = Infinity, maxSheets = Infinity } = options;
  const columnLimit = Math.min(MAX_COLUMN_COUNT, options.maxColumns ?? MAX_COLUMN_COUNT);
  const zip = openZip(bytes);
  const text = (name: string) => zip.read(name)?.toString("utf8") ?? null;
  const workbook = text("xl/workbook.xml");
  const rels = text("xl/_rels/workbook.xml.rels");
  if (!workbook || !rels) throw new Error("xlsx: buku kerja tidak lengkap");
  const targets = new Map<string, string>();
  for (const tag of startTags(rels, "Relationship")) {
    const id = attribute(tag.attrs, "Id");
    const target = attribute(tag.attrs, "Target");
    if (id && target) targets.set(id, target.startsWith("/") ? target.slice(1) : `xl/${target}`);
  }
  const shared: string[] = [];
  for (const item of elements(text("xl/sharedStrings.xml") ?? "", "si")) {
    if (shared.length >= MAX_SHARED_STRINGS) throw new Error("xlsx: terlalu banyak teks bersama");
    shared.push(textOf(item.body ?? ""));
  }
  const parseRows = (xml: string): string[][] => {
    const rows: string[][] = [];
    for (const rowElement of elements(xml, "row")) {
      if (rows.length >= maxRows) break;
      const row: string[] = [];
      for (const cellElement of elements(rowElement.body ?? "", "c")) {
        const type = attribute(cellElement.attrs, "t");
        const reference = attribute(cellElement.attrs, "r");
        const body = cellElement.body ?? "";
        const value = valueOf(body);
        let cell = "";
        if (type === "s") cell = value === undefined ? "" : shared[Number(value)] ?? "";
        else if (type === "inlineStr") cell = textOf(body);
        else if (value !== undefined) {
          cell = decodeEntities(value);
          if (formatNumber && (type === null || type === "n")) cell = formatNumber(cell);
        }
        const referenced = reference ? columnIndex(reference) : -1;
        const index = referenced < 0 ? row.length : referenced;
        if (index >= columnLimit) continue;
        while (row.length < index) row.push("");
        row[index] = cell.trim();
      }
      rows.push(row);
    }
    while (rows.length && rows[rows.length - 1].every((cell) => cell === "")) rows.pop();
    return rows;
  };
  const parsed = new Map<string, string[][] | null>();
  const rowsOf = (path: string): string[][] | null => {
    const cached = parsed.get(path);
    if (cached !== undefined) return cached;
    const xml = text(path);
    const rows = xml ? parseRows(xml) : null;
    parsed.set(path, rows);
    return rows;
  };
  const sheets: XlsxSheet[] = [];
  for (const tag of startTags(workbook, "sheet")) {
    if (sheets.length >= maxSheets) break;
    const name = attribute(tag.attrs, "name");
    const id = attribute(tag.attrs, "r:id");
    const path = id ? targets.get(id) : null;
    const rows = name && path ? rowsOf(path) : null;
    if (!name || !rows) continue;
    sheets.push({ name, rows });
  }
  return sheets;
}
