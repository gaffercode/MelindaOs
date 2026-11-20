/*
 * Document Studio drafts: the editable copy of a preset, plus everything derived from it without
 * React (completeness check, category A Markdown, the /api/studio/generate payload).
 */
import type { FormPreset, SkPreset, SpoPreset } from "./document-studio-presets";

export type DocType = "spo" | "sk" | "form";

export const DIRECTOR_SIGNATORY = "dr. Ferdi Andriska, S.H., M.Kn., CMDC";

export type SpoDraft = Omit<SpoPreset, "name" | "starkesCode">;
export type FormDraft = Omit<FormPreset, "name">;
/** Menimbang and mengingat are edited as one line per item; the four diktum are KESATU to KEEMPAT. */
export type SkDraft = { no_sk: string; tentang: string; menimbang: string; mengingat: string; diktum: [string, string, string, string] };

export const SK_DIKTUM_LABELS = ["KESATU", "KEDUA", "KETIGA", "KEEMPAT"] as const;

export function spoDraftFrom(preset: SpoPreset): SpoDraft {
  return {
    jenis: preset.jenis, title: preset.title, doc_no: preset.doc_no, rev: preset.rev, date: preset.date, unit: preset.unit,
    pengertian: preset.pengertian, tujuan: preset.tujuan, ruang_lingkup: preset.ruang_lingkup, kebijakan: preset.kebijakan,
    tanggung_jawab: preset.tanggung_jawab, unit_terkait: preset.unit_terkait, prosedur: preset.prosedur,
    dokumen_terkait: preset.dokumen_terkait, riwayat_revisi: preset.riwayat_revisi,
    disusun_jabatan: preset.disusun_jabatan, disusun_nama: preset.disusun_nama,
    diperiksa_jabatan: preset.diperiksa_jabatan, diperiksa_nama: preset.diperiksa_nama,
  };
}

export function skDraftFrom(preset: SkPreset): SkDraft {
  const diktum = (index: number) => preset.diktum[index]?.isi || "";
  return {
    no_sk: preset.no_sk, tentang: preset.tentang,
    menimbang: preset.menimbang.join("\n"), mengingat: preset.mengingat.join("\n"),
    diktum: [diktum(0), diktum(1), diktum(2), diktum(3)],
  };
}

export function formDraftFrom(preset: FormPreset): FormDraft {
  return {
    title: preset.title, form_code: preset.form_code, starkes_ref: preset.starkes_ref, unit: preset.unit,
    instructions: preset.instructions, sections: preset.sections,
  };
}

/** STARKES basics: the fields a 9-element SPO cannot be compiled without. */
export function isSpoComplete(spo: SpoDraft): boolean {
  return spo.title.length >= 5 &&
    spo.doc_no.length >= 3 &&
    spo.pengertian.length >= 10 &&
    spo.tujuan.length >= 10 &&
    spo.kebijakan.length >= 10 &&
    spo.prosedur.length >= 10 &&
    spo.unit_terkait.length >= 3;
}

export function spoMarkdown(spo: SpoDraft): string {
  return `---
doc_id: kb-spo-${spo.doc_no.toLowerCase().replace(/[^a-z0-9]/g, "-")}
title: ${spo.title}
domain: Operasional
department: ${spo.unit}
version: "${spo.rev}"
last_reviewed: 2026-10-25
ftdr_safety_override: false
tags:
  - spo
  - starkes
  - rumah-sakit
---

# ${spo.title}

## Identitas Dokumen

| Butir | Isi |
| --- | --- |
| Rumah sakit | RSIA Melinda DHAI, Jl. Balowerti II No. 59, Kediri, Jawa Timur |
| Telepon dan website | (0354) 691016; melinda.co.id |
| Jenis dokumen | ${spo.jenis} |
| Nomor dokumen | ${spo.doc_no} |
| Nomor revisi | ${spo.rev} |
| Tanggal terbit / berlaku | ${spo.date} |
| Unit pemilik | ${spo.unit} |
| Status | DRAF UNTUK KOREKSI |

## 1. Pengertian
${spo.pengertian}

## 2. Tujuan
${spo.tujuan}

## 3. Ruang Lingkup
${spo.ruang_lingkup}

## 4. Kebijakan
${spo.kebijakan}

## 5. Tanggung Jawab
${spo.tanggung_jawab}

## 6. Unit Terkait
${spo.unit_terkait}

## 7. Prosedur
${spo.prosedur}

## 8. Dokumen Terkait
${spo.dokumen_terkait}

## 9. Riwayat Revisi
${spo.riwayat_revisi}

## Pengesahan Dokumen

| Peran | Jabatan | Nama | Tanda tangan dan tanggal |
| --- | --- | --- | --- |
| Disusun oleh | ${spo.disusun_jabatan} | ${spo.disusun_nama} | [ISI] |
| Diperiksa oleh | ${spo.diperiksa_jabatan} | ${spo.diperiksa_nama} | [ISI] |
| Disahkan oleh | Direktur | ${DIRECTOR_SIGNATORY} | [ISI] |
`;
}

/** The `data` object /api/studio/generate expects for each document type. */
export function studioPayload(docType: DocType, drafts: { spo: SpoDraft; sk: SkDraft; form: FormDraft }): Record<string, unknown> {
  const { spo, sk, form } = drafts;
  if (docType === "spo") {
    return {
      title: spo.title,
      jenis: spo.jenis,
      doc_no: spo.doc_no,
      rev: spo.rev,
      date: spo.date,
      unit: spo.unit,
      disusun_jabatan: spo.disusun_jabatan,
      disusun_nama: spo.disusun_nama,
      diperiksa_jabatan: spo.diperiksa_jabatan,
      diperiksa_nama: spo.diperiksa_nama,
      sections: {
        "1. Pengertian": spo.pengertian,
        "2. Tujuan": spo.tujuan,
        "3. Ruang Lingkup": spo.ruang_lingkup,
        "4. Kebijakan": spo.kebijakan,
        "5. Tanggung Jawab": spo.tanggung_jawab,
        "6. Unit Terkait": spo.unit_terkait,
        "7. Prosedur": spo.prosedur,
        "8. Dokumen Terkait": spo.dokumen_terkait,
        "9. Riwayat Revisi": spo.riwayat_revisi,
      },
    };
  }
  if (docType === "sk") {
    return {
      no_sk: sk.no_sk,
      tentang: sk.tentang,
      menimbang: sk.menimbang.split("\n").filter(Boolean),
      mengingat: sk.mengingat.split("\n").filter(Boolean),
      diktum: SK_DIKTUM_LABELS.map((label, index) => ({ label, isi: sk.diktum[index] })),
    };
  }
  return {
    title: form.title,
    form_code: form.form_code,
    starkes_ref: form.starkes_ref,
    unit: form.unit,
    instructions: form.instructions,
    sections: form.sections,
  };
}
