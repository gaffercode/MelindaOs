import { rgb } from "pdf-lib";
import {
  COLORS,
  PdfPainter,
  asText,
  wrapText,
} from "./pdf-kit";

export interface StudioFormRow {
  item?: string;
  desc?: string;
  options?: string;
}

export interface StudioFormSection {
  title?: string;
  rows?: StudioFormRow[];
}

export interface StudioFormData {
  title?: string;
  form_code?: string;
  starkes_ref?: string;
  unit?: string;
  instructions?: string;
  sections?: StudioFormSection[];
}

export async function buildFormPdf(data: StudioFormData): Promise<Uint8Array> {
  const p = new PdfPainter({ marginX: 40, marginTop: 28, marginBottom: 28 });
  await p.init();

  const title = asText(data.title, "Formulir Klinis / Akreditasi");
  const formCode = asText(data.form_code, "FORM-…");
  const starkesRef = asText(data.starkes_ref, "STARKES");
  const unit = asText(data.unit, "Unit Pelayanan");
  const instructions = asText(data.instructions, "");
  const sections = Array.isArray(data.sections) ? data.sections : [];

  p.footerLabel = "Formulir Rekam Medis";
  p.drawHospitalKop();
  p.drawCenteredText(title, 13.5, p.bold);
  p.drawCenteredText(`${formCode} | ${starkesRef}`, 9.5, p.italic, COLORS.muted);
  p.drawMetaGrid([
    ["Nomor dokumen", formCode],
    ["Nomor revisi", "00"],
    ["Tanggal terbit", "5 November 2026"],
    ["Tanggal berlaku", "5 November 2026"],
    ["Unit pemilik", unit],
    ["Status", "DRAF UNTUK KOREKSI"],
  ]);

  // Patient sticker box (clinical forms)
  const headerH = 48;
  p.ensureSpace(headerH + 8);
  const colWs = [p.contentW];
  p.page.drawRectangle({
    x: p.marginX,
    y: p.y - headerH,
    width: p.contentW,
    height: headerH,
    borderColor: COLORS.border,
    borderWidth: 0.75,
  });
  let x = p.marginX;
  const cols = [
    {
      lines: [
        "KOTAK IDENTITAS PASIEN",
        "Nama: [................................]    No. RM: [............]    Tgl Lahir: [../../....]",
        "NIK: [........................]    L / P",
      ],
      fill: undefined as undefined,
    },
  ];
  cols.forEach((col, index) => {
    if (col.fill) {
      p.page.drawRectangle({
        x,
        y: p.y - headerH,
        width: colWs[index],
        height: headerH,
        color: col.fill,
      });
    }
    if (index > 0) {
      p.page.drawLine({
        start: { x, y: p.y },
        end: { x, y: p.y - headerH },
        thickness: 0.5,
        color: COLORS.grid,
      });
    }
    col.lines.forEach((line, lineIndex) => {
      const font = lineIndex === 0 ? p.bold : p.font;
      const size = lineIndex === 0 ? 8 : 7;
      const color = index === 1 && lineIndex === 1 ? COLORS.orange : COLORS.ink;
      wrapText(font, line, size, colWs[index] - 8).slice(0, 1).forEach((wrapped) => {
        p.page.drawText(wrapped, {
          x: x + 4,
          y: p.y - 12 - lineIndex * 10,
          size,
          font,
          color,
        });
      });
    });
    x += colWs[index];
  });
  p.y -= headerH + 10;

  if (instructions) {
    const lines = wrapText(p.font, `Petunjuk Pengisian: ${instructions}`, 8, p.contentW - 10);
    const boxH = lines.length * 10 + 10;
    p.drawBox(boxH, { fill: COLORS.lightBg, border: rgb(0.58, 0.639, 0.722), borderWidth: 0.5 });
    lines.forEach((line, i) => {
      p.page.drawText(line, {
        x: p.marginX + 5,
        y: p.y - 12 - i * 10,
        size: 8,
        font: i === 0 ? p.bold : p.font,
        color: COLORS.ink,
      });
    });
    p.y -= boxH + 10;
  }

  for (const section of sections) {
    const secTitle = asText(section.title, "Checklist Pemeriksaan");
    const rows = Array.isArray(section.rows) ? section.rows : [];
    const widths = [28, 250, 120, p.contentW - 398];

    p.drawTableRow(
      [
        { text: "NO", width: widths[0], header: true },
        { text: secTitle.toUpperCase(), width: widths[1], header: true },
        { text: "STATUS / HASIL", width: widths[2], header: true },
        { text: "VERIFIKASI & CATATAN", width: widths[3], header: true },
      ],
      16
    );

    rows.forEach((row, index) => {
      const item = asText(row.item, "-");
      const desc = asText(row.desc, "");
      const options = asText(row.options, "[  ] Ya    [  ] Tidak    [  ] N/A");
      const itemText = desc ? `${item} — ${desc}` : item;
      const lineCount = Math.max(
        wrapText(p.bold, itemText, 7.5, widths[1] - 6).length,
        wrapText(p.font, options, 7.5, widths[2] - 6).length,
        1
      );
      p.drawTableRow(
        [
          { text: String(index + 1), width: widths[0], bold: true },
          { text: itemText, width: widths[1], bold: true },
          { text: options, width: widths[2], bold: true },
          { text: "Paraf: ..... Jam: .....", width: widths[3] },
        ],
        Math.max(18, lineCount * 9 + 8)
      );
    });
    p.gap(10);
  }

  const signH = 70;
  p.ensureSpace(signH + 16);
  p.page.drawRectangle({
    x: p.marginX,
    y: p.y - signH,
    width: p.contentW,
    height: signH,
    borderColor: rgb(0.58, 0.639, 0.722),
    borderWidth: 0.5,
  });
  const signCols = [
    ["Tanggal & Waktu Pengisian:", "Tgl: ...... / ...... / 2026", "Pukul: ........ WIB"],
    ["Petugas / Perawat Pelaksana:", "", "( ................................................ )", "Nama Terang & Tanda Tangan"],
    ["DPJP / Dokter Penanggung Jawab:", "", "( ................................................ )", "Nama Terang & SIP"],
  ];
  const signW = p.contentW / 3;
  signCols.forEach((lines, index) => {
    const sx = p.marginX + index * signW;
    if (index > 0) {
      p.page.drawLine({
        start: { x: sx, y: p.y },
        end: { x: sx, y: p.y - signH },
        thickness: 0.5,
        color: COLORS.grid,
      });
    }
    lines.forEach((line, lineIndex) => {
      if (!line) return;
      p.page.drawText(line, {
        x: sx + 6,
        y: p.y - 12 - lineIndex * 12,
        size: 7.5,
        font: lineIndex === 0 ? p.bold : p.font,
        color: COLORS.ink,
      });
    });
  });
  p.y -= signH + 10;

  p.drawCenteredText(
    "DOKUMEN REKAM MEDIS RAHASIA — RSIA MELINDA DHAI KEDIRI · STANDAR AKREDITASI RUMAH SAKIT KEMENKES RI (STARKES)",
    6.5,
    p.font,
    COLORS.muted
  );

  return p.save();
}
