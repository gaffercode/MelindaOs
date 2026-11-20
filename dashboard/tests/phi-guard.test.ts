import { describe, expect, it } from "vitest";
import { findPatientIdentifiers } from "@/lib/phi-guard";

describe("findPatientIdentifiers", () => {
  it("detects each identifier category", () => {
    expect(findPatientIdentifiers("NIK 3571012345678901 mohon dicek")).toEqual(["nik"]);
    expect(findPatientIdentifiers("cek No. RM 123456 hari ini")).toEqual(["rekam_medis"]);
    expect(findPatientIdentifiers("rekam medis: 0045123 belum lengkap")).toEqual(["rekam_medis"]);
    expect(findPatientIdentifiers("Kamar Ny. Sari perlu dicek")).toEqual(["nama_pasien"]);
    expect(findPatientIdentifiers("pasien By Ayu rujuk")).toEqual(["nama_pasien"]);
    expect(findPatientIdentifiers("tgl lahir 12/03/1990")).toEqual(["tanggal_lahir"]);
  });
  it("detects spacing, MR label and date variants", () => {
    expect(findPatientIdentifiers("NIK 3571 0123 4567 8901")).toEqual(["nik"]);
    expect(findPatientIdentifiers("No. MR 123456")).toEqual(["rekam_medis"]);
    expect(findPatientIdentifiers("MR 123456")).toEqual(["rekam_medis"]);
    expect(findPatientIdentifiers("RM 00-12-34")).toEqual(["rekam_medis"]);
    expect(findPatientIdentifiers("Ny.Sari")).toEqual(["nama_pasien"]);
    expect(findPatientIdentifiers("ny. sari")).toEqual(["nama_pasien"]);
    expect(findPatientIdentifiers("Tn. budi")).toEqual(["nama_pasien"]);
    expect(findPatientIdentifiers("lahir 12.03.1990")).toEqual(["tanggal_lahir"]);
    expect(findPatientIdentifiers("lahir 12 Maret 1990")).toEqual(["tanggal_lahir"]);
    expect(findPatientIdentifiers("lahir di Kediri 12-03-1990")).toEqual(["tanggal_lahir"]);
    expect(findPatientIdentifiers("TTL Kediri 12-03-1990")).toEqual(["tanggal_lahir"]);
  });
  it("detects RM separators, MRN label and ISO birth dates", () => {
    expect(findPatientIdentifiers("No. RM-001234")).toEqual(["rekam_medis"]);
    expect(findPatientIdentifiers("MRN 123456")).toEqual(["rekam_medis"]);
    expect(findPatientIdentifiers("tgl lahir 1990-03-12")).toEqual(["tanggal_lahir"]);
  });
  it("passes ordinary operational notes", () => {
    expect(findPatientIdentifiers("tolong cek  status rm hr ini")).toEqual([]);
    expect(findPatientIdentifiers("Rekap klaim BPJS 2026 per item, tenggat 16.00")).toEqual([]);
    expect(findPatientIdentifiers("rapat by Senin")).toEqual([]);
    expect(findPatientIdentifiers("Annisa dari keuangan ikut rapat")).toEqual([]);
  });
});
