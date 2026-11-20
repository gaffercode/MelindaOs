import { degrees, rgb } from "pdf-lib";
import {
  COLORS,
  PAGE_H,
  PAGE_W,
  PdfPainter,
  SIGNATORY,
  asText,
  drawCentered,
  wrapText,
} from "./pdf-kit";

export interface StarkesDossierItem {
  code?: string;
  title?: string;
  r?: string;
  d?: string;
  o?: string;
  w?: string;
  score?: number;
  evidence_status?: string;
}

export interface StarkesEvidenceIndexEntry {
  code: string;
  title: string;
  status: string;
  attachments?: string[];
  studio_presets?: string[];
}

export interface StarkesDossierData {
  chapter_code?: string;
  chapter_name?: string;
  chapter_group?: string;
  desc?: string;
  target_score?: number;
  current_score?: number;
  lock_state?: string;
  evidence_index?: StarkesEvidenceIndexEntry[];
  watermark_text?: string;
  items?: StarkesDossierItem[];
}

class DossierPainter extends PdfPainter {
  private watermark?: string;

  async build(data: StarkesDossierData): Promise<Uint8Array> {
    await this.init();
    this.watermark = typeof data.watermark_text === "string" && data.watermark_text.trim() ? data.watermark_text.trim() : undefined;

    const chapterCode = asText(data.chapter_code, "SKP");
    const chapterName = asText(data.chapter_name, "Sasaran Keselamatan Pasien");
    const chapterGroup = asText(data.chapter_group, "Keselamatan & Mutu");
    const desc = asText(data.desc, "");
    const targetScore = typeof data.target_score === "number" ? data.target_score : 80;
    const items = Array.isArray(data.items) ? data.items : [];
    const currentScore =
      typeof data.current_score === "number"
        ? data.current_score
        : items.reduce((sum, item) => sum + (typeof item.score === "number" ? item.score : 0), 0);
    const maxPoints = Math.max(items.length * 10, 0);
    const scorePct = maxPoints > 0 ? Math.round((currentScore / maxPoints) * 100) : 0;
    const statusLabel = scorePct >= 80 ? "TERPENUHI (PARIPURNA)" : "DALAM PEMENUHAN DOKUMEN";

    this.drawWatermark();
    this.drawHeader(chapterCode, chapterName, chapterGroup, desc);
    this.drawMetrics(chapterCode, targetScore, scorePct, currentScore, maxPoints, statusLabel, asText(data.lock_state, "draft"));
    this.drawMatrix(chapterCode, items);
    this.drawEvidenceIndex(Array.isArray(data.evidence_index) ? data.evidence_index : []);
    this.drawSignoff(chapterCode);
    this.ensureSpace(18);
    drawCentered(
      this.page,
      this.font,
      "BERKAS RESMI TIM AKREDITASI RSIA MELINDA DHAI KEDIRI · STANDAR STARKES KEMENKES RI · DISETUJUI DIREKTUR",
      6.5,
      this.y,
      COLORS.muted
    );

    return this.save();
  }

  private drawWatermark() {
    if (!this.watermark) return;
    const size = 28;
    const text = this.watermark;
    const width = this.bold.widthOfTextAtSize(text, size);
    this.page.drawText(text, {
      x: (PAGE_W - width) / 2,
      y: PAGE_H / 2,
      size,
      font: this.bold,
      color: rgb(0.92, 0.93, 0.94),
      rotate: degrees(35),
    });
  }

  private drawHeader(code: string, name: string, group: string, desc: string) {
    this.drawCenteredText("STANDAR AKREDITASI RUMAH SAKIT KEMENKES RI (STARKES)", 8, this.bold, COLORS.orange);
    this.drawCenteredText(`BERKAS DOSSIER KESIAPAN AKREDITASI: BAB ${code}`, 14, this.bold);
    this.drawCenteredText(`${name.toUpperCase()} (${group})`, 10, this.bold);
    if (desc) {
      const lines = wrapText(this.font, `RSIA Melinda DHAI Kediri · ${desc}`, 8, this.contentW);
      for (const line of lines) {
        this.drawCenteredText(line, 8, this.font, COLORS.muted);
      }
    }
    this.drawRule(COLORS.border, 2);
  }

  private drawMetrics(
    code: string,
    target: number,
    pct: number,
    current: number,
    maxPoints: number,
    status: string,
    lockState: string
  ) {
    const cells = [
      { label: "BAB STARKES", value: code },
      { label: "TARGET SKOR", value: `${target}% Minimal` },
      { label: "CAPAIAN SKOR", value: `${pct}% (${current}/${maxPoints})` },
      { label: "STATUS KESIAPAN", value: status },
      { label: "KUNCI AUDIT BAB", value: lockState.toUpperCase() },
      { label: "DIREKTUR PENANGGUNG JAWAB", value: SIGNATORY },
    ];
    const colW = this.contentW / cells.length;
    const boxH = 42;
    this.ensureSpace(boxH + 8);
    this.page.drawRectangle({
      x: this.marginX,
      y: this.y - boxH,
      width: this.contentW,
      height: boxH,
      color: COLORS.lightBg,
      borderColor: COLORS.border,
      borderWidth: 1,
    });
    cells.forEach((cell, index) => {
      const x = this.marginX + index * colW;
      if (index > 0) {
        this.page.drawLine({
          start: { x, y: this.y },
          end: { x, y: this.y - boxH },
          thickness: 0.5,
          color: COLORS.grid,
        });
      }
      this.page.drawText(cell.label, { x: x + 4, y: this.y - 12, size: 6.5, font: this.bold, color: COLORS.ink });
      const valueColor = cell.label === "STATUS KESIAPAN" ? COLORS.emerald : COLORS.ink;
      wrapText(this.bold, cell.value, 7, colW - 8)
        .slice(0, 2)
        .forEach((line, lineIndex) => {
          this.page.drawText(line, {
            x: x + 4,
            y: this.y - 24 - lineIndex * 9,
            size: 7,
            font: this.bold,
            color: valueColor,
          });
        });
    });
    this.y -= boxH + 12;
  }

  private drawMatrix(code: string, items: StarkesDossierItem[]) {
    this.ensureSpace(20);
    this.page.drawText(`MATRIKS PEMENUHAN INSTRUMEN R-D-O-W (BAB ${code})`, {
      x: this.marginX,
      y: this.y,
      size: 10,
      font: this.bold,
      color: COLORS.ink,
    });
    this.y -= 14;

    const cols = [
      { title: "KODE", width: 42 },
      { title: "ELEMEN PENILAIAN", width: 108 },
      { title: "R (REGULASI)", width: 118 },
      { title: "D (DOKUMEN)", width: 118 },
      { title: "O & W", width: 90 },
      { title: "SKOR", width: 39 },
    ] as const;
    const headerH = 18;
    this.ensureSpace(headerH + 4);
    this.page.drawRectangle({
      x: this.marginX,
      y: this.y - headerH,
      width: this.contentW,
      height: headerH,
      color: COLORS.border,
    });
    let x = this.marginX;
    for (const col of cols) {
      this.page.drawText(col.title, {
        x: x + 3,
        y: this.y - 12,
        size: 6.5,
        font: this.bold,
        color: COLORS.white,
      });
      x += col.width;
    }
    this.y -= headerH;

    for (const item of items) {
      const cellLines = [
        wrapText(this.bold, asText(item.code, "-"), 7, cols[0].width - 6),
        wrapText(this.bold, asText(item.title, "-"), 7, cols[1].width - 6),
        wrapText(this.font, asText(item.r, "-"), 7, cols[2].width - 6),
        wrapText(this.font, asText(item.d, "-"), 7, cols[3].width - 6),
        wrapText(this.font, `O: ${asText(item.o, "-")}  W: ${asText(item.w, "-")}`, 7, cols[4].width - 6),
        wrapText(this.bold, `${typeof item.score === "number" ? item.score : 0}/10`, 7, cols[5].width - 6),
      ];
      const maxLines = Math.max(...cellLines.map((lines) => lines.length), 1);
      const rowH = Math.max(18, maxLines * 9 + 8);
      this.ensureSpace(rowH + 2);

      this.page.drawRectangle({
        x: this.marginX,
        y: this.y - rowH,
        width: this.contentW,
        height: rowH,
        borderColor: COLORS.border,
        borderWidth: 0.75,
      });

      let cx = this.marginX;
      cellLines.forEach((lines, index) => {
        if (index > 0) {
          this.page.drawLine({
            start: { x: cx, y: this.y },
            end: { x: cx, y: this.y - rowH },
            thickness: 0.5,
            color: COLORS.grid,
          });
        }
        const font = index === 0 || index === 1 || index === 5 ? this.bold : this.font;
        lines.forEach((line, lineIndex) => {
          this.page.drawText(line, {
            x: cx + 3,
            y: this.y - 11 - lineIndex * 9,
            size: 7,
            font,
            color: COLORS.ink,
          });
        });
        cx += cols[index].width;
      });
      this.y -= rowH;
    }
    this.y -= 12;
  }

  private drawEvidenceIndex(entries: StarkesEvidenceIndexEntry[]) {
    if (!entries.length) return;
    this.ensureSpace(20);
    this.page.drawText("INDEKS BUKTI & TAUTAN STUDIO", {
      x: this.marginX,
      y: this.y,
      size: 10,
      font: this.bold,
      color: COLORS.ink,
    });
    this.y -= 14;
    for (const entry of entries) {
      const attach = (entry.attachments ?? []).join(", ");
      const presets = (entry.studio_presets ?? []).join(", ");
      const line = `${entry.code} · ${entry.status}${presets ? ` · Studio: ${presets}` : ""}${attach ? ` · Lampiran: ${attach}` : ""}`;
      wrapText(this.font, line, 7.5, this.contentW).forEach((textLine) => {
        this.ensureSpace(10);
        this.page.drawText(textLine, { x: this.marginX, y: this.y, size: 7.5, font: this.font, color: COLORS.ink });
        this.y -= 10;
      });
      wrapText(this.bold, asText(entry.title, ""), 7, this.contentW).slice(0, 2).forEach((textLine) => {
        this.ensureSpace(10);
        this.page.drawText(textLine, { x: this.marginX + 8, y: this.y, size: 7, font: this.font, color: COLORS.muted });
        this.y -= 10;
      });
      this.y -= 4;
    }
    this.y -= 8;
  }

  private drawSignoff(code: string) {
    const colW = this.contentW / 3;
    const boxH = 78;
    this.ensureSpace(boxH + 8);
    this.page.drawRectangle({
      x: this.marginX,
      y: this.y - boxH,
      width: this.contentW,
      height: boxH,
      borderColor: rgb(0.58, 0.639, 0.722),
      borderWidth: 0.75,
    });
    const blocks = [
      {
        title: "Disiapkan Oleh:",
        body: `Ketua Pokja Akreditasi Bab ${code}`,
        foot: "( ............................................................ )\nNIP: ....................................................",
      },
      {
        title: "Diverifikasi Oleh:",
        body: "Ketua Komite Mutu & Akreditasi RS",
        foot: "( dr. Siti Rahmawati, Sp.OG )\nKetua Komite Akreditasi",
      },
      {
        title: "Disahkan Oleh:",
        body: "Direktur RSIA Melinda DHAI Kediri",
        foot: `${SIGNATORY}\nDirektur Utama`,
      },
    ];
    blocks.forEach((block, index) => {
      const x = this.marginX + index * colW;
      if (index > 0) {
        this.page.drawLine({
          start: { x, y: this.y },
          end: { x, y: this.y - boxH },
          thickness: 0.5,
          color: COLORS.grid,
        });
      }
      this.page.drawText(block.title, { x: x + 6, y: this.y - 12, size: 7.5, font: this.bold, color: COLORS.ink });
      wrapText(this.font, block.body, 7, colW - 12).forEach((line, i) => {
        this.page.drawText(line, { x: x + 6, y: this.y - 24 - i * 9, size: 7, font: this.font, color: COLORS.ink });
      });
      block.foot.split("\n").forEach((line, i) => {
        const font = index === 2 && i === 0 ? this.bold : this.font;
        this.page.drawText(line, { x: x + 6, y: this.y - 52 - i * 9, size: 7, font, color: COLORS.ink });
      });
    });
    this.y -= boxH + 10;
  }
}

export async function buildStarkesDossierPdf(data: StarkesDossierData): Promise<Uint8Array> {
  return new DossierPainter().build(data ?? {});
}
