import type { DocumentBlock, DocumentKind } from "./contracts";

export const REQUIRED_SECTIONS: Record<DocumentKind, readonly string[]> = {
  spo: ["pengertian", "tujuan", "ruang_lingkup", "kebijakan", "tanggung_jawab", "unit_terkait", "prosedur", "dokumen_terkait", "riwayat_revisi"],
  sk: ["menimbang", "mengingat", "memutuskan"],
  program: ["tujuan", "kegiatan", "jadwal", "penanggung_jawab", "evaluasi"],
  pedoman: ["tujuan", "ruang_lingkup", "tata_laksana", "evaluasi"],
  form: ["petunjuk"], monitoring: ["petunjuk"], materi: ["tujuan", "materi"],
};

export function blockText(block: DocumentBlock): string[] {
  switch (block.type) {
    case "text": return [block.text];
    case "list": return block.items;
    case "table": return [...block.headers, ...block.rows.flat()];
    case "input": return [block.label];
  }
}

export function validDocumentDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}

export const UNFINISHED_COPY = /\[\s*(?:ISI|CEK)\b[^\]]*\]|\bdra[f t]+\s+untuk\s+koreksi\b|\bdraft\s+for\s+(?:owner\s+)?approval\b/i;
