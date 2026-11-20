import {
  COLORS,
  PdfPainter,
  SIGNATORY,
  asText,
  wrapText,
} from "./pdf-kit";

export interface StudioSkDiktum {
  label?: string;
  isi?: string;
}

export interface StudioSkData {
  no_sk?: string;
  tentang?: string;
  menimbang?: unknown;
  mengingat?: unknown;
  diktum?: StudioSkDiktum[];
  tanggal?: string;
}

function listItems(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => asText(item).trim()).filter(Boolean);
  if (typeof value === "string") return value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return [];
}

export async function buildSkPdf(data: StudioSkData): Promise<Uint8Array> {
  const p = new PdfPainter({ marginX: 50, marginTop: 36, marginBottom: 36 });
  await p.init();

  const noSk = asText(data.no_sk, "[ISI]/SK-DIR/…/…");
  const tentang = asText(data.tentang, "Keputusan Direktur RSIA Melinda DHAI");
  const menimbang = listItems(data.menimbang);
  const mengingat = listItems(data.mengingat);
  const diktum = Array.isArray(data.diktum) ? data.diktum : [];
  const tanggal = asText(data.tanggal, "25 Oktober 2026");

  p.footerLabel = "Keputusan Direktur";
  p.drawHospitalKop();
  p.drawCenteredText("KEPUTUSAN DIREKTUR RSIA MELINDA DHAI", 13.5, p.bold);
  p.drawCenteredText(`NOMOR: ${noSk}`, 11, p.bold);
  p.gap(2);
  p.drawCenteredText("TENTANG", 10, p.bold);
  const tentangLines = wrapText(p.bold, tentang.toUpperCase(), 10, p.contentW);
  for (const line of tentangLines) {
    p.drawCenteredText(line, 10, p.bold, COLORS.ink);
  }
  p.drawMetaGrid([
    ["Nomor dokumen", noSk],
    ["Nomor revisi", "00"],
    ["Tanggal terbit", tanggal],
    ["Tanggal berlaku", tanggal],
    ["Unit pemilik", "Direksi RSIA Melinda DHAI"],
    ["Status", "DRAF UNTUK KOREKSI"],
  ]);
  p.drawCenteredText("DIREKTUR RSIA MELINDA DHAI KEDIRI,", 10, p.bold);
  p.gap(8);

  const labelW = 70;
  const colonW = 12;
  const bodyW = p.contentW - labelW - colonW;

  function drawLabeledBlock(label: string, items: string[], ordered: "alpha" | "number") {
    p.ensureSpace(24);
    const startY = p.y;
    p.page.drawText(label, { x: p.marginX, y: p.y, size: 9.5, font: p.bold, color: COLORS.ink });
    p.page.drawText(":", { x: p.marginX + labelW, y: p.y, size: 9.5, font: p.bold, color: COLORS.ink });
    let bodyY = p.y;
    const bodyX = p.marginX + labelW + colonW;
    if (items.length === 0) {
      p.page.drawText("[ISI]", { x: bodyX, y: bodyY, size: 9, font: p.font, color: COLORS.muted });
      bodyY -= 12;
    } else {
      items.forEach((item, index) => {
        const prefix = ordered === "alpha" ? `${String.fromCharCode(97 + index)}. ` : `${index + 1}. `;
        const lines = wrapText(p.font, `${prefix}${item}`, 9, bodyW);
        for (const line of lines) {
          if (bodyY < p.marginBottom + 20) {
            p.newPage();
            bodyY = p.y;
          }
          p.page.drawText(line, { x: bodyX, y: bodyY, size: 9, font: p.font, color: COLORS.ink });
          bodyY -= 12;
        }
        bodyY -= 2;
      });
    }
    p.y = Math.min(startY - 16, bodyY - 6);
  }

  drawLabeledBlock("Menimbang", menimbang, "alpha");
  drawLabeledBlock("Mengingat", mengingat, "number");

  p.gap(6);
  p.drawCenteredText("MEMUTUSKAN:", 11, p.bold);
  p.gap(4);

  const defaultLabels = ["KESATU", "KEDUA", "KETIGA", "KEEMPAT"];
  const rows = diktum.length
    ? diktum
    : defaultLabels.map((label) => ({ label, isi: "[ISI]" }));

  for (const [index, row] of rows.entries()) {
    const label = asText(row.label, defaultLabels[index] ?? `POINT ${index + 1}`);
    const isi = asText(row.isi, "[ISI]");
    p.ensureSpace(28);
    p.page.drawText(label, { x: p.marginX, y: p.y, size: 9.5, font: p.bold, color: COLORS.ink });
    p.page.drawText(":", { x: p.marginX + labelW, y: p.y, size: 9.5, font: p.bold, color: COLORS.ink });
    const lines = wrapText(p.font, isi, 9, bodyW);
    let bodyY = p.y;
    const bodyX = p.marginX + labelW + colonW;
    for (const line of lines) {
      if (bodyY < p.marginBottom + 20) {
        p.newPage();
        bodyY = p.y;
      }
      p.page.drawText(line, { x: bodyX, y: bodyY, size: 9, font: p.font, color: COLORS.ink });
      bodyY -= 12;
    }
    p.y = bodyY - 8;
  }

  p.gap(8);
  p.drawPengesahanBlock({
    place: "Kediri",
    date: tanggal,
    jabatan: "Direktur RSIA Melinda DHAI",
    nama: SIGNATORY,
  });

  p.gap(6);
  p.drawCenteredText("DRAF UNTUK KOREKSI — KEPUTUSAN DIREKTUR RSIA MELINDA DHAI", 7, p.font, COLORS.muted);

  return p.save();
}
