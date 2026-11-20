import { describe, expect, it } from "vitest";
import { readXlsx } from "@/lib/xlsx-read";
import { buildRawZip } from "./helpers/xlsx-fixture";

const MIB = 1024 * 1024;
const RELS = `<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>`;

function workbook(sheetXml: string, extra: Array<{ name: string; data: string }> = [], sheets = `<sheet name="S" r:id="rId1"/>`): Uint8Array<ArrayBuffer> {
  const files = [
    { name: "xl/workbook.xml", data: `<workbook><sheets>${sheets}</sheets></workbook>` },
    { name: "xl/_rels/workbook.xml.rels", data: RELS },
    { name: "xl/worksheets/sheet1.xml", data: sheetXml },
    ...extra,
  ];
  return buildRawZip(files.map((file) => ({ name: file.name, method: 0, data: Buffer.from(file.data, "utf8") })));
}

function sheet(rows: string): string {
  return `<worksheet><sheetData>${rows}</sheetData></worksheet>`;
}

function timed(run: () => unknown): number {
  const start = performance.now();
  run();
  return performance.now() - start;
}

describe("readXlsx linear scanning", () => {
  it("reads 2 MiB of unclosed <row> quickly and yields no rows", () => {
    const bytes = workbook(sheet("<row>".repeat((2 * MIB) / 5)));
    let rows: string[][] = [["x"]];
    expect(timed(() => { rows = readXlsx(bytes)[0].rows; })).toBeLessThan(1000);
    expect(rows).toEqual([]);
  });

  it("reads 2 MiB of unclosed <c> inside one row quickly", () => {
    const bytes = workbook(sheet(`<row>${"<c>".repeat((2 * MIB) / 3)}</row>`));
    let rows: string[][] = [["x"]];
    expect(timed(() => { rows = readXlsx(bytes)[0].rows; })).toBeLessThan(1000);
    expect(rows).toEqual([]);
  });

  it("reads 2 MiB of unclosed <si> in shared strings quickly", () => {
    const bytes = workbook(sheet(`<row><c t="s"><v>0</v></c></row>`), [{ name: "xl/sharedStrings.xml", data: `<sst>${"<si>".repeat((2 * MIB) / 4)}</sst>` }]);
    let rows: string[][] = [["x"]];
    expect(timed(() => { rows = readXlsx(bytes)[0].rows; })).toBeLessThan(1000);
    expect(rows).toEqual([]);
  });

  it("throws a fixed message beyond 200 000 shared strings", () => {
    const bytes = workbook(sheet(""), [{ name: "xl/sharedStrings.xml", data: `<sst>${"<si><t>a</t></si>".repeat(200_001)}</sst>` }]);
    expect(() => readXlsx(bytes)).toThrow(/^xlsx: terlalu banyak teks bersama$/);
  });

  it("accepts exactly 200 000 shared strings", () => {
    const bytes = workbook(sheet(`<row><c t="s"><v>199999</v></c></row>`), [{ name: "xl/sharedStrings.xml", data: `<sst>${"<si><t>a</t></si>".repeat(200_000)}</sst>` }]);
    expect(readXlsx(bytes)[0].rows).toEqual([["a"]]);
  });

  it("returns two equal sheets when two <sheet> elements point at one path", () => {
    const bytes = workbook(sheet(`<row><c t="inlineStr"><is><t>A</t></is></c><c><v>1</v></c></row>`), [], `<sheet name="S1" r:id="rId1"/><sheet name="S2" r:id="rId1"/>`);
    const sheets = readXlsx(bytes);
    expect(sheets.map((entry) => entry.name)).toEqual(["S1", "S2"]);
    expect(sheets[0].rows).toEqual([["A", "1"]]);
    expect(sheets[1].rows).toEqual(sheets[0].rows);
  });

  it("inflates a sheet path once however many <sheet> elements point at it", () => {
    // Four reads of a 17 MiB entry would pass the 64 MiB per-call budget; one read does not.
    const padding = " ".repeat(17 * MIB);
    const bytes = workbook(sheet(`<row><c><v>7</v></c></row>${padding}`), [], [1, 2, 3, 4].map((index) => `<sheet name="S${index}" r:id="rId1"/>`).join(""));
    const sheets = readXlsx(bytes);
    expect(sheets).toHaveLength(4);
    for (const entry of sheets) expect(entry.rows).toEqual([["7"]]);
  });

  it("decodes an invalid numeric entity as empty and keeps valid entities", () => {
    const bytes = workbook(sheet(`<row><c t="inlineStr"><is><t>x&#99999999;y</t></is></c><c t="inlineStr"><is><t>&amp;&lt;&#65;&#x42;</t></is></c><c><v>&#xFFFFFFFF;</v></c></row>`));
    expect(readXlsx(bytes)[0].rows).toEqual([["xy", "&<AB", ""]]);
  });

  it("places a cell whose reference has no column at the next position", () => {
    const bytes = workbook(sheet(`<row><c r="A1"><v>1</v></c><c r="12"><v>2</v></c><c r="D1"><v>3</v></c></row>`));
    expect(readXlsx(bytes)[0].rows).toEqual([["1", "2", "", "3"]]);
  });

  it("reads self-closing rows and cells, and text runs", () => {
    const bytes = workbook(sheet(`<row r="1"/><row r="2"><c r="A2"/><c r="B2" t="inlineStr"><is><r><t>Ab</t></r><r><t xml:space="preserve"> c</t></r></is></c></row>`));
    expect(readXlsx(bytes)[0].rows).toEqual([[], ["", "Ab c"]]);
  });
});
