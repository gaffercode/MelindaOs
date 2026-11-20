import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import fontkit from "@pdf-lib/fontkit";
import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFImage,
  type PDFPage,
  type RGB,
} from "pdf-lib";

export const PAGE_W = 595.28; // A4
export const PAGE_H = 841.89;
/** Official RSIA Melinda document margins (from Surat Pernyataan template). */
export const MARGIN_X = 42.5;
export const MARGIN_TOP = 36;
export const MARGIN_BOTTOM = 36;
export const CONTENT_W = PAGE_W - MARGIN_X * 2;

export const SIGNATORY = "dr. Ferdi Andriska, S.H., M.Kn., CMDC";
export const HOSPITAL_LINE_1 = "RUMAH SAKIT IBU DAN ANAK";
export const HOSPITAL_NAME = "RSIA MELINDA DHAI";
export const HOSPITAL_CITY = "Kota Kediri";
export const HOSPITAL_ADDR = "Jl. Balowerti II No. 59, Balowerti, Kota Kediri, Jawa Timur 64129";
export const HOSPITAL_CONTACT = "Telp. (0354) 691016 | info.melinda@melinda.co.id";

/** Official palette from RSIA Melinda surat template (Carlito/Calibri #111 / #444). */
export const COLORS = {
  ink: rgb(0.067, 0.067, 0.067),
  muted: rgb(0.267, 0.267, 0.267),
  orange: rgb(0.918, 0.345, 0.047),
  maroon: rgb(0.067, 0.067, 0.067),
  gold: rgb(0.067, 0.067, 0.067),
  lightBg: rgb(0.973, 0.98, 0.988),
  cream: rgb(0.984, 0.969, 0.973),
  border: rgb(0.067, 0.067, 0.067),
  grid: rgb(0.067, 0.067, 0.067),
  white: rgb(1, 1, 1),
  emerald: rgb(0.016, 0.471, 0.341),
  rule: rgb(0.067, 0.067, 0.067),
} as const;

export function asText(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return fallback;
}

export function wrapText(font: PDFFont, value: string, size: number, maxWidth: number): string[] {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return [""];
  const words = normalized.split(" ");
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) <= maxWidth) {
      current = next;
      continue;
    }
    if (current) lines.push(current);
    if (font.widthOfTextAtSize(word, size) <= maxWidth) {
      current = word;
      continue;
    }
    let chunk = "";
    for (const ch of word) {
      const trial = chunk + ch;
      if (font.widthOfTextAtSize(trial, size) <= maxWidth) chunk = trial;
      else {
        if (chunk) lines.push(chunk);
        chunk = ch;
      }
    }
    current = chunk;
  }
  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

export function drawCentered(
  page: PDFPage,
  font: PDFFont,
  value: string,
  size: number,
  y: number,
  color: RGB = COLORS.ink,
  pageWidth = PAGE_W
) {
  const width = font.widthOfTextAtSize(value, size);
  page.drawText(value, { x: (pageWidth - width) / 2, y, size, font, color });
}

function resolveAsset(...parts: string[]): string | null {
  const candidates = [
    join(/*turbopackIgnore: true*/ process.cwd(), ...parts),
    join(/*turbopackIgnore: true*/ process.cwd(), "dashboard", ...parts),
    join(/*turbopackIgnore: true*/ process.cwd(), "public", ...parts.slice(1)),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/** Multi-page A4 painter shared by Studio and STARKES dossier builders. */
export class PdfPainter {
  doc!: PDFDocument;
  page!: PDFPage;
  font!: PDFFont;
  bold!: PDFFont;
  italic!: PDFFont;
  logo: PDFImage | null = null;
  y = PAGE_H - MARGIN_TOP;
  pageIndex = 0;
  footerLabel = "Dokumen RSIA Melinda DHAI";
  readonly marginX: number;
  readonly contentW: number;
  readonly marginTop: number;
  readonly marginBottom: number;

  constructor(opts: { marginX?: number; marginTop?: number; marginBottom?: number } = {}) {
    this.marginX = opts.marginX ?? MARGIN_X;
    this.marginTop = opts.marginTop ?? MARGIN_TOP;
    this.marginBottom = opts.marginBottom ?? MARGIN_BOTTOM;
    this.contentW = PAGE_W - this.marginX * 2;
  }

  async init(): Promise<void> {
    this.doc = await PDFDocument.create();
    this.doc.registerFontkit(fontkit);
    const regularPath = resolveAsset("assets", "fonts", "carlito", "Carlito-Regular.ttf");
    const boldPath = resolveAsset("assets", "fonts", "carlito", "Carlito-Bold.ttf");
    const italicPath = resolveAsset("assets", "fonts", "carlito", "Carlito-Italic.ttf");
    if (regularPath && boldPath) {
      this.font = await this.doc.embedFont(readFileSync(/*turbopackIgnore: true*/ regularPath));
      this.bold = await this.doc.embedFont(readFileSync(/*turbopackIgnore: true*/ boldPath));
      this.italic = italicPath
        ? await this.doc.embedFont(readFileSync(/*turbopackIgnore: true*/ italicPath))
        : this.font;
    } else {
      this.font = await this.doc.embedFont(StandardFonts.Helvetica);
      this.bold = await this.doc.embedFont(StandardFonts.HelveticaBold);
      this.italic = await this.doc.embedFont(StandardFonts.HelveticaOblique);
    }

    const logoPath =
      resolveAsset("public", "branding", "rsia-melinda-logo-official.png") ??
      resolveAsset("public", "branding", "rsia-melinda-logo-official.jpg") ??
      resolveAsset("public", "kredensial", "assets", "logo_melinda_official.png");
    if (logoPath) {
      const bytes = readFileSync(/*turbopackIgnore: true*/ logoPath);
      this.logo = logoPath.toLowerCase().endsWith(".jpg") || logoPath.toLowerCase().endsWith(".jpeg")
        ? await this.doc.embedJpg(bytes)
        : await this.doc.embedPng(bytes);
    }

    this.page = this.doc.addPage([PAGE_W, PAGE_H]);
    this.pageIndex = 1;
    this.y = PAGE_H - this.marginTop;
  }

  async save(): Promise<Uint8Array> {
    this.stampFooters();
    return this.doc.save();
  }

  private stampFooters() {
    const pages = this.doc.getPages();
    pages.forEach((page, index) => {
      page.drawText(this.footerLabel, {
        x: this.marginX,
        y: 24,
        size: 8,
        font: this.font,
        color: COLORS.muted,
      });
      const right = `Halaman ${index + 1} dari ${pages.length}`;
      const w = this.font.widthOfTextAtSize(right, 8);
      page.drawText(right, {
        x: PAGE_W - this.marginX - w,
        y: 24,
        size: 8,
        font: this.font,
        color: COLORS.muted,
      });
    });
  }

  newPage() {
    this.page = this.doc.addPage([PAGE_W, PAGE_H]);
    this.pageIndex += 1;
    this.y = PAGE_H - this.marginTop;
  }

  ensureSpace(needed: number) {
    if (this.y - needed < this.marginBottom + 12) this.newPage();
  }

  gap(amount = 8) {
    this.y -= amount;
  }

  drawCenteredText(value: string, size: number, font: PDFFont = this.bold, color: RGB = COLORS.ink) {
    this.ensureSpace(size + 4);
    drawCentered(this.page, font, value, size, this.y, color);
    this.y -= size + 4;
  }

  drawWrapped(
    value: string,
    size: number,
    font: PDFFont = this.font,
    color: RGB = COLORS.ink,
    maxWidth = this.contentW,
    x = this.marginX
  ) {
    const lines = wrapText(font, value, size, maxWidth);
    for (const line of lines) {
      this.ensureSpace(size + 3);
      this.page.drawText(line, { x, y: this.y, size, font, color });
      this.y -= size + 3;
    }
  }

  drawRule(color: RGB = COLORS.rule, thickness = 2.25) {
    this.ensureSpace(thickness + 8);
    this.page.drawRectangle({
      x: this.marginX,
      y: this.y,
      width: this.contentW,
      height: thickness,
      color,
    });
    this.y -= thickness + 10;
  }

  /**
   * Official RSIA Melinda letterhead: logo left + centered identity + thick rule.
   * Geometry taken from the hospital's official letterhead (Nov 2026).
   */
  drawHospitalKop(_opts: { kicker?: string; accent?: RGB } = {}) {
    const logoW = 42;
    const logoH = 40;
    const logoX = 57;
    const logoY = PAGE_H - 92;
    if (this.logo) {
      this.page.drawImage(this.logo, { x: logoX, y: logoY, width: logoW, height: logoH });
    }

    // Centered identity block (pdf y from top ≈ 38 → 110)
    drawCentered(this.page, this.bold, HOSPITAL_LINE_1, 9, PAGE_H - 49, COLORS.ink);
    drawCentered(this.page, this.bold, HOSPITAL_NAME, 16, PAGE_H - 68, COLORS.ink);
    drawCentered(this.page, this.font, HOSPITAL_CITY, 10, PAGE_H - 83, COLORS.ink);
    drawCentered(this.page, this.font, HOSPITAL_ADDR, 8.5, PAGE_H - 96, COLORS.muted);
    drawCentered(this.page, this.font, HOSPITAL_CONTACT, 8.5, PAGE_H - 108, COLORS.muted);

    this.y = PAGE_H - 126;
    this.drawRule(COLORS.rule, 2.25);
  }

  /** 2-column × 3-row meta grid under the document title (official template). */
  drawMetaGrid(rows: Array<[string, string]>) {
    const colW = this.contentW / 2;
    const rowH = 16.5;
    const startY = this.y;
    const totalH = rowH * Math.ceil(rows.length / 2);

    this.ensureSpace(totalH + 8);

    // Outer border
    this.page.drawRectangle({
      x: this.marginX,
      y: startY - totalH,
      width: this.contentW,
      height: totalH,
      borderColor: COLORS.border,
      borderWidth: 0.5,
    });

    // Mid vertical
    this.page.drawLine({
      start: { x: this.marginX + colW, y: startY },
      end: { x: this.marginX + colW, y: startY - totalH },
      thickness: 0.5,
      color: COLORS.border,
    });

    for (let i = 0; i < rows.length; i += 2) {
      const rowIndex = i / 2;
      const yTop = startY - rowIndex * rowH;
      if (rowIndex > 0) {
        this.page.drawLine({
          start: { x: this.marginX, y: yTop },
          end: { x: this.marginX + this.contentW, y: yTop },
          thickness: 0.5,
          color: COLORS.border,
        });
      }
      const left = rows[i];
      const right = rows[i + 1];
      const textY = yTop - 11.5;
      if (left) {
        this.page.drawText(`${left[0]}: ${left[1]}`, {
          x: this.marginX + 5.5,
          y: textY,
          size: 8.5,
          font: this.font,
          color: COLORS.ink,
        });
      }
      if (right) {
        this.page.drawText(`${right[0]}: ${right[1]}`, {
          x: this.marginX + colW + 5.5,
          y: textY,
          size: 8.5,
          font: this.font,
          color: COLORS.ink,
        });
      }
    }

    this.y = startY - totalH - 12;
  }

  drawBox(height: number, opts: { fill?: RGB; border?: RGB; borderWidth?: number } = {}) {
    this.ensureSpace(height + 4);
    this.page.drawRectangle({
      x: this.marginX,
      y: this.y - height,
      width: this.contentW,
      height,
      color: opts.fill,
      borderColor: opts.border ?? COLORS.border,
      borderWidth: opts.borderWidth ?? 1,
    });
  }

  drawTableRow(
    cells: Array<{ text: string; width: number; bold?: boolean; color?: RGB; header?: boolean }>,
    rowH: number
  ) {
    this.ensureSpace(rowH + 2);
    let x = this.marginX;
    const top = this.y;
    this.page.drawRectangle({
      x: this.marginX,
      y: top - rowH,
      width: this.contentW,
      height: rowH,
      borderColor: COLORS.border,
      borderWidth: 0.75,
      color: cells[0]?.header ? COLORS.border : undefined,
    });
    cells.forEach((cell, index) => {
      if (index > 0) {
        this.page.drawLine({
          start: { x, y: top },
          end: { x, y: top - rowH },
          thickness: 0.5,
          color: COLORS.grid,
        });
      }
      const font = cell.bold || cell.header ? this.bold : this.font;
      const color = cell.header ? COLORS.white : cell.color ?? COLORS.ink;
      const lines = wrapText(font, cell.text, cell.header ? 7 : 7.5, cell.width - 6);
      lines.slice(0, Math.max(1, Math.floor((rowH - 6) / 9))).forEach((line, lineIndex) => {
        this.page.drawText(line, {
          x: x + 3,
          y: top - 11 - lineIndex * 9,
          size: cell.header ? 7 : 7.5,
          font,
          color,
        });
      });
      x += cell.width;
    });
    this.y -= rowH;
  }

  /** Right-aligned pengesahan block matching official surat. */
  drawPengesahanBlock(opts: {
    place?: string;
    date?: string;
    jabatan?: string;
    nama?: string;
    sip?: string;
  }) {
    this.ensureSpace(90);
    this.page.drawText("Pengesahan dan Penetapan", {
      x: this.marginX,
      y: this.y,
      size: 11,
      font: this.bold,
      color: COLORS.ink,
    });
    this.y -= 16;

    const x = this.marginX + this.contentW / 2 + 10;
    this.page.drawText(`Ditetapkan di: ${opts.place ?? "Kediri"}`, {
      x,
      y: this.y,
      size: 8.5,
      font: this.font,
      color: COLORS.ink,
    });
    this.y -= 13;
    this.page.drawText(`Pada tanggal: ${opts.date ?? "[ISI]"}`, {
      x,
      y: this.y,
      size: 8.5,
      font: this.font,
      color: COLORS.ink,
    });
    this.y -= 13;
    this.page.drawText(opts.jabatan ?? "Direktur RSIA Melinda DHAI", {
      x,
      y: this.y,
      size: 8.5,
      font: this.bold,
      color: COLORS.ink,
    });
    this.y -= 48;
    this.page.drawText(opts.nama ?? SIGNATORY, {
      x,
      y: this.y,
      size: 8.5,
      font: this.bold,
      color: COLORS.ink,
    });
    this.y -= 13;
    this.page.drawText(opts.sip ?? "SIP/NIP: Definitif Direksi RSIA Melinda DHAI", {
      x,
      y: this.y,
      size: 8.5,
      font: this.font,
      color: COLORS.ink,
    });
    this.y -= 16;
  }
}
