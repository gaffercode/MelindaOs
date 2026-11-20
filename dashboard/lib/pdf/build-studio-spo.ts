import {
  COLORS,
  PdfPainter,
  SIGNATORY,
  asText,
  wrapText,
} from "./pdf-kit";

export interface StudioSpoData {
  title?: string;
  jenis?: string;
  doc_no?: string;
  nomor?: string;
  rev?: string;
  date?: string;
  date_effective?: string;
  unit?: string;
  hospital?: string;
  contact?: string;
  status?: string;
  subtitle?: string;
  disusun_jabatan?: string;
  disusun_nama?: string;
  diperiksa_jabatan?: string;
  diperiksa_nama?: string;
  sections?: Record<string, unknown>;
}

function sectionLines(value: unknown): string[] {
  if (typeof value === "string") {
    return value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  }
  if (Array.isArray(value)) {
    return value.map((item) => asText(item).trim()).filter(Boolean);
  }
  return [];
}

export async function buildSpoPdf(data: StudioSpoData): Promise<Uint8Array> {
  const p = new PdfPainter({ marginX: 42.5, marginTop: 36, marginBottom: 36 });
  await p.init();

  const title = asText(data.title, "Dokumen Standar Rumah Sakit");
  const jenis = asText(data.jenis, "Standar Prosedur Operasional (SPO)");
  const docNo = asText(data.doc_no ?? data.nomor, "[ISI]");
  const rev = asText(data.rev, "00");
  const date = asText(data.date, "[ISI]");
  const dateEffective = asText(data.date_effective, date);
  const unit = asText(data.unit, "Pelayanan Medis / Komite Medik");
  const status = asText(data.status, "DRAF UNTUK KOREKSI");
  const subtitle = asText(data.subtitle, "STANDAR AKREDITASI RUMAH SAKIT (STARKES)");
  const sections = data.sections && typeof data.sections === "object" && !Array.isArray(data.sections) ? data.sections : {};

  p.footerLabel = jenis.includes("SPO") ? "Standar Prosedur Operasional" : jenis;

  // Official kop
  p.drawHospitalKop();

  // Document title block (centered, like Surat Pernyataan)
  p.drawCenteredText(title, 13.5, p.bold, COLORS.ink);
  if (subtitle) {
    p.drawCenteredText(subtitle, 9.5, p.italic, COLORS.muted);
  }
  p.drawCenteredText(jenis.toUpperCase(), 10, p.bold, COLORS.ink);
  p.gap(4);

  // Official 2×3 meta grid
  p.drawMetaGrid([
    ["Nomor dokumen", docNo],
    ["Nomor revisi", rev],
    ["Tanggal terbit", date],
    ["Tanggal berlaku", dateEffective],
    ["Unit pemilik", unit],
    ["Status", status],
  ]);

  // Nine sections
  for (const [heading, raw] of Object.entries(sections)) {
    p.ensureSpace(28);
    p.page.drawText(asText(heading), { x: p.marginX, y: p.y, size: 11, font: p.bold, color: COLORS.ink });
    p.y -= 14;

    const lines = sectionLines(raw);
    if (lines.length === 0) {
      p.drawWrapped("[ISI]", 9, p.font, COLORS.muted);
    } else {
      for (const line of lines) {
        p.drawWrapped(line, 9, p.font, COLORS.ink);
        p.gap(2);
      }
    }
    p.gap(10);
  }

  // Three-role approval table (SPO requires compiled/reviewed/authorized)
  p.ensureSpace(40);
  p.page.drawText("Pengesahan Dokumen", { x: p.marginX, y: p.y, size: 11, font: p.bold, color: COLORS.ink });
  p.y -= 14;

  const roles = [
    {
      role: "Disusun oleh",
      jabatan: asText(data.disusun_jabatan, "Penanggung Jawab Prosedur"),
      nama: asText(data.disusun_nama, "[ISI]"),
    },
    {
      role: "Diperiksa oleh",
      jabatan: asText(data.diperiksa_jabatan, "Wakil Direktur Operasional (interim Komite Mutu)"),
      nama: asText(data.diperiksa_nama, "dr. Novia Dwi Anggraini"),
    },
    {
      role: "Disahkan oleh",
      jabatan: "Direktur RSIA Melinda DHAI",
      nama: SIGNATORY,
    },
  ];
  const colW = [90, 150, 160, p.contentW - 400];
  p.drawTableRow(
    [
      { text: "Peran", width: colW[0], header: true },
      { text: "Jabatan", width: colW[1], header: true },
      { text: "Nama", width: colW[2], header: true },
      { text: "Tanda tangan dan tanggal", width: colW[3], header: true },
    ],
    16
  );
  for (const role of roles) {
    const nameLines = Math.max(wrapText(p.font, role.nama, 7.5, colW[2] - 6).length, 1);
    const jabLines = Math.max(wrapText(p.font, role.jabatan, 7.5, colW[1] - 6).length, 1);
    p.drawTableRow(
      [
        { text: role.role, width: colW[0], bold: true },
        { text: role.jabatan, width: colW[1] },
        { text: role.nama, width: colW[2], bold: role.role === "Disahkan oleh" },
        { text: "", width: colW[3] },
      ],
      Math.max(28, Math.max(nameLines, jabLines) * 9 + 10)
    );
  }

  p.gap(8);
  p.drawCenteredText("DRAF UNTUK KOREKSI — RSIA MELINDA DHAI KEDIRI", 7, p.font, COLORS.muted);

  return p.save();
}
