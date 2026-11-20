/** RFC 4180 CSV reader for Director uploads: quotes, doubled quotes, CR/LF, a BOM, and a comma or semicolon
 * delimiter picked from the first line. No dependency; the shape is kept raw (header + rows) because the
 * distributor spreadsheets have no fixed column set. */
export type CsvTable = { delimiter: "," | ";"; header: string[]; rows: string[][] };

export const CSV_MAX_ROWS = 5000;
export const CSV_MAX_COLUMNS = 60;

export function sniffDelimiter(firstLine: string): "," | ";" {
  const commas = (firstLine.match(/,/g) ?? []).length, semicolons = (firstLine.match(/;/g) ?? []).length;
  return semicolons > commas ? ";" : ",";
}

export function parseCsv(text: string): CsvTable {
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const firstBreak = source.search(/\r?\n/);
  const delimiter = sniffDelimiter(firstBreak === -1 ? source : source.slice(0, firstBreak));
  const records: string[][] = [];
  let field = "", record: string[] = [], quoted = false;
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (quoted) {
      if (char === '"') {
        if (source[i + 1] === '"') { field += '"'; i += 1; } else quoted = false;
      } else field += char;
      continue;
    }
    if (char === '"') { quoted = true; continue; }
    if (char === delimiter) { record.push(field); field = ""; continue; }
    if (char === "\r") continue;
    if (char === "\n") { record.push(field); records.push(record); field = ""; record = []; continue; }
    field += char;
  }
  if (field.length > 0 || record.length > 0) { record.push(field); records.push(record); }
  const nonEmpty = records.filter((row) => row.some((cell) => cell.trim() !== ""));
  if (nonEmpty.length === 0) return { delimiter, header: [], rows: [] };
  const [first, ...rest] = nonEmpty;
  const header = first.map((cell) => cell.trim()).slice(0, CSV_MAX_COLUMNS);
  const rows = rest.slice(0, CSV_MAX_ROWS).map((row) => header.map((_, index) => (row[index] ?? "").trim()));
  return { delimiter, header, rows };
}
