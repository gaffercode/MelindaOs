/*
 * Document Studio presets (SPO/Pedoman, Formulir, SK). The hospital's own drafts live in
 * dashboard/data/content/studio-presets.json (fictional in the repository, real on production); the editor state and
 * the PDF flow are in document-studio-view.tsx, the /api/studio payload in document-studio-drafts.ts.
 */
import content from "@/data/content/studio-presets.json";
import { arrayOf, isObject, isString, isStringArray, requireFields } from "@/lib/content/content-file";

export interface SpoPreset {
  name: string;
  starkesCode?: string;
  jenis: string;
  title: string;
  doc_no: string;
  rev: string;
  date: string;
  unit: string;
  pengertian: string;
  tujuan: string;
  ruang_lingkup: string;
  kebijakan: string;
  tanggung_jawab: string;
  unit_terkait: string;
  prosedur: string;
  dokumen_terkait: string;
  riwayat_revisi: string;
  disusun_jabatan: string;
  disusun_nama: string;
  diperiksa_jabatan: string;
  diperiksa_nama: string;
}

export interface FormPreset {
  name: string;
  form_code: string;
  starkes_ref: string;
  unit: string;
  title: string;
  instructions: string;
  sections: Array<{
    title: string;
    rows: Array<{ item: string; desc: string; options: string }>;
  }>;
}

export interface SkPreset {
  name: string;
  no_sk: string;
  tentang: string;
  menimbang: string[];
  mengingat: string[];
  diktum: Array<{ label: string; isi: string }>;
}

const FILE = "studio-presets.json";
const SPO_TEXT_FIELDS = [
  "name", "jenis", "title", "doc_no", "rev", "date", "unit", "pengertian", "tujuan", "ruang_lingkup", "kebijakan",
  "tanggung_jawab", "unit_terkait", "prosedur", "dokumen_terkait", "riwayat_revisi", "disusun_jabatan", "disusun_nama",
  "diperiksa_jabatan", "diperiksa_nama",
] as const;
const isRow = (v: unknown) => isObject(v) && isString(v.item) && isString(v.desc) && isString(v.options);
const isSection = (v: unknown) => isObject(v) && isString(v.title) && arrayOf(isRow)(v.rows);
const isDiktum = (v: unknown) => isObject(v) && isString(v.label) && isString(v.isi);

requireFields(FILE, "root", content, { spo: Array.isArray, forms: Array.isArray, sk: Array.isArray });
content.spo.forEach((preset, i) =>
  requireFields(FILE, `spo[${i}]`, preset, Object.fromEntries(SPO_TEXT_FIELDS.map((key) => [key, isString])), { starkesCode: isString }),
);
content.forms.forEach((preset, i) =>
  requireFields(FILE, `forms[${i}]`, preset, {
    name: isString, form_code: isString, starkes_ref: isString, unit: isString, title: isString, instructions: isString,
    sections: arrayOf(isSection),
  }),
);
content.sk.forEach((preset, i) =>
  requireFields(FILE, `sk[${i}]`, preset, {
    name: isString, no_sk: isString, tentang: isString, menimbang: isStringArray, mengingat: isStringArray, diktum: arrayOf(isDiktum),
  }),
);
if (content.spo.length === 0 || content.forms.length === 0 || content.sk.length === 0) {
  throw new Error(`dashboard/data/content/${FILE}: every preset list needs at least one entry.`);
}

export const SPO_PRESETS: SpoPreset[] = content.spo as SpoPreset[];
export const FORM_PRESETS: FormPreset[] = content.forms as FormPreset[];
export const SK_PRESETS: SkPreset[] = content.sk as SkPreset[];
