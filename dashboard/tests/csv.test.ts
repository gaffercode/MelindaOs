import { describe, expect, it } from "vitest";
import { CSV_MAX_ROWS, parseCsv, sniffDelimiter } from "@/lib/csv";

describe("CSV reader for Order obat uploads", () => {
  it("reads a comma file with quotes, doubled quotes, CRLF and a BOM", () => {
    const text = "﻿Barang,Jumlah,\"Harga, satuan\"\r\n\"Paracetamol \"\"500\"\"\",10,1500\r\nInfus RL,2,\"12,000\"\r\n";
    const table = parseCsv(text);
    expect(table.delimiter).toBe(",");
    expect(table.header).toEqual(["Barang", "Jumlah", "Harga, satuan"]);
    expect(table.rows).toEqual([["Paracetamol \"500\"", "10", "1500"], ["Infus RL", "2", "12,000"]]);
  });

  it("sniffs a semicolon file (Excel in Indonesian locale) and pads short rows", () => {
    expect(sniffDelimiter("Barang;Jumlah;Harga")).toBe(";");
    const table = parseCsv("Barang;Jumlah;Harga\nMisoprostol;5\n\n");
    expect(table.delimiter).toBe(";");
    expect(table.rows).toEqual([["Misoprostol", "5", ""]]);
  });

  it("returns an empty header for an empty file and caps the row count", () => {
    expect(parseCsv("").header).toEqual([]);
    const many = ["a,b", ...Array.from({ length: CSV_MAX_ROWS + 5 }, (_, i) => `${i},x`)].join("\n");
    expect(parseCsv(many).rows).toHaveLength(CSV_MAX_ROWS);
  });
});
