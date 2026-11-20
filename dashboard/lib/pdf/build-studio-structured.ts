import type { StudioDocument } from "../studio/contracts";
import { COLORS, PdfPainter, SIGNATORY, wrapText } from "./pdf-kit";

/** Split tall rows rather than dropping wrapped lines at a page boundary. */
function drawTable(p: PdfPainter, headers: string[], rows: string[][]) {
  const width = p.contentW / headers.length;
  const lineH = 12;
  function paint(lines: string[][], count: number, header = false) {
    const height = count * lineH + 8;
    lines.forEach((column, i) => {
      p.page.drawRectangle({ x: p.marginX + i * width, y: p.y - height, width, height, borderColor: COLORS.border, borderWidth: 0.5, color: header ? COLORS.lightBg : undefined });
      column.forEach((line, j) => p.page.drawText(line, { x: p.marginX + i * width + 4, y: p.y - 14 - j * lineH, size: 9, font: header ? p.bold : p.font, color: COLORS.ink }));
    });
    p.y -= height;
  }
  const heading = headers.map((h) => wrapText(p.bold, h, 9, width - 8));
  const headerLines = Math.max(...heading.map((h) => h.length));
  function repeatHeader() { p.ensureSpace(headerLines * lineH + 8 + 24); paint(heading, headerLines, true); }
  repeatHeader();
  for (const row of rows) {
    const wrapped = row.map((text) => wrapText(p.font, text, 9, width - 8));
    const max = Math.max(...wrapped.map((c) => c.length));
    let offset = 0;
    while (offset < max) {
      let available = Math.floor((p.y - p.marginBottom - 24) / lineH);
      if (available < 1) { p.newPage(); repeatHeader(); available = Math.floor((p.y - p.marginBottom - 24) / lineH); }
      const count = Math.min(available, max - offset);
      paint(wrapped.map((c) => c.slice(offset, offset + count)), count);
      offset += count;
    }
  }
  p.gap(10);
}

export async function buildStructuredStudioPdf(doc: StudioDocument, mode: "preview" | "final" | "manual-signature"): Promise<Uint8Array> {
  const p = new PdfPainter(); await p.init();
  p.footerLabel = doc.number || doc.title;
  p.drawHospitalKop(); p.drawWrapped(doc.title, 14, p.bold);
  if (mode === "preview") p.drawWrapped("DRAF UNTUK KOREKSI", 10, p.bold, COLORS.orange);
  const missingNumber = mode === "manual-signature" ? "________________" : "Belum diterbitkan";
  const missingDate = mode === "manual-signature" ? "________________" : "Belum ditetapkan";
  p.drawMetaGrid([["Nomor dokumen", doc.number ?? missingNumber], ["Nomor revisi", doc.revision], ["Tanggal penetapan", doc.issueDate ?? missingDate], ["Unit pemilik", doc.unit]]);
  for (const section of doc.sections) {
    p.ensureSpace(45); p.drawWrapped(section.heading, 11, p.bold); p.gap(4);
    for (const block of section.blocks) {
      if (block.type === "text") p.drawWrapped(block.text, 10);
      else if (block.type === "list") block.items.forEach((item, i) => { p.drawWrapped(`${i + 1}. ${item}`, 10); p.gap(4); });
      else if (block.type === "input") { p.drawWrapped(`${block.label}: ____________________`, 10); p.gap(8); }
      else drawTable(p, block.headers, block.rows);
      p.gap(6);
    }
  }
  p.ensureSpace(125); p.drawWrapped("Pengesahan", 11, p.bold);
  p.drawWrapped(`Ditetapkan di Kediri, ${doc.issueDate ?? missingDate}`, 10);
  p.drawWrapped(doc.authority === "director" ? "Direktur RSIA Melinda DHAI" : "Pemilik RSIA Melinda DHAI", 10);
  p.gap(48);
  if (doc.authority === "director") p.drawWrapped(SIGNATORY, 10, p.bold);
  return p.save();
}
