/** Builds small .xlsx workbooks for tests: a stored (method 0) zip that `readXlsx` can read. Not a test file. */
export type FixtureCell = string | { n: string };

export const ORDER_GRID: string[][] = [
  ["PENGAJUAN ORDER OBAT", "", "", "", "", "", ""],
  ["TGL : 03 November 26", "", "", "", "", "", ""],
  ["NO", "DISTRIBUTOR", "NAMA BARANG", "JML", "SATUAN", "HARGA", "TOTAL HARGA"],
  ["1", "PT ALFA", "PARACETAMOL 500 MG", "10", "BOX", "25000", "250000"],
  ["", "", "AMOXICILLIN 500 MG", "5", "BOX", "40.000", "210.000"],
  ["", "", "", "", "", "TOTAL", "460000"],
  ["2", "PT BETA", "NACL 0,9% 500 ML", "20", "BTL", "8000", "160000"],
  ["", "", "", "", "", "TOTAL", "160000"],
  ["", "", "", "", "", "TOTAL ALL", "620000"],
  ["Kepala Unit Farmasi,", "", "", "", "", "Direktur,", ""],
  ["apt. Contoh Satu", "", "", "", "", "dr Contoh Dua", ""],
];

function escapeXml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function columnLetters(index: number): string {
  let letters = "";
  for (let rest = index + 1; rest > 0; rest = Math.floor((rest - 1) / 26)) letters = String.fromCharCode(65 + ((rest - 1) % 26)) + letters;
  return letters;
}

function sheetXml(rows: FixtureCell[][]): string {
  const body = rows
    .map((row, rowIndex) => {
      const cells = row
        .map((cell, columnIndex) => {
          const reference = `${columnLetters(columnIndex)}${rowIndex + 1}`;
          if (typeof cell !== "string") return `<c r="${reference}"><v>${escapeXml(cell.n)}</v></c>`;
          if (cell === "") return "";
          return `<c r="${reference}" t="inlineStr"><is><t>${escapeXml(cell)}</t></is></c>`;
        })
        .join("");
      return `<row r="${rowIndex + 1}">${cells}</row>`;
    })
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`;
}

/** Stored zip: local headers, central directory and end record. `readZip` reads sizes and offsets from the
 * central directory and ignores CRCs, so the CRC fields are 0. */
function storedZip(files: Array<{ name: string; data: string }>): Uint8Array<ArrayBuffer> {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name, "utf8");
    const data = Buffer.from(file.data, "utf8");
    const local = Buffer.alloc(30 + name.length + data.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    name.copy(local, 30);
    data.copy(local, 30 + name.length);
    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    name.copy(central, 46);
    locals.push(local);
    centrals.push(central);
    offset += local.length;
  }
  const directorySize = centrals.reduce((total, part) => total + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directorySize, 12);
  end.writeUInt32LE(offset, 16);
  const parts = [...locals, ...centrals, end];
  const bytes = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let position = 0;
  for (const part of parts) {
    bytes.set(part, position);
    position += part.length;
  }
  return bytes;
}

/** A zip with entries exactly as given: any method number, data already compressed for that method, and an optional declared size. */
export function buildRawZip(entries: Array<{ name: string; method: number; data: Uint8Array; size?: number }>): Uint8Array<ArrayBuffer> {
  const parts: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const local = Buffer.alloc(30 + name.length + entry.data.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(entry.method, 8);
    local.writeUInt32LE(entry.data.length, 18);
    local.writeUInt32LE(entry.size ?? entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    name.copy(local, 30);
    local.set(entry.data, 30 + name.length);
    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(entry.method, 10);
    central.writeUInt32LE(entry.data.length, 20);
    central.writeUInt32LE(entry.size ?? entry.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    name.copy(central, 46);
    parts.push(local);
    centrals.push(central);
    offset += local.length;
  }
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centrals.reduce((total, part) => total + part.length, 0), 12);
  end.writeUInt32LE(offset, 16);
  const all = [...parts, ...centrals, end];
  const bytes = new Uint8Array(all.reduce((total, part) => total + part.length, 0));
  let position = 0;
  for (const part of all) {
    bytes.set(part, position);
    position += part.length;
  }
  return bytes;
}

export function buildXlsx(sheets: Array<{ name: string; rows: FixtureCell[][] }>): Uint8Array<ArrayBuffer> {
  const workbook = `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets
    .map((sheet, index) => `<sheet name="${escapeXml(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`)
    .join("")}</sheets></workbook>`;
  const rels = `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets
    .map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`)
    .join("")}</Relationships>`;
  return storedZip([
    { name: "xl/workbook.xml", data: workbook },
    { name: "xl/_rels/workbook.xml.rels", data: rels },
    ...sheets.map((sheet, index) => ({ name: `xl/worksheets/sheet${index + 1}.xml`, data: sheetXml(sheet.rows) })),
  ]);
}
