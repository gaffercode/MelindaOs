import { statusLabels, type Instruction } from "../director/director-instructions";
import { COLORS, PdfPainter, SIGNATORY, wrapText } from "./pdf-kit";

export type RecapRow = { code: string; date: string; title: string; pic: string; status: string; days: string };
export const MONTH_NAMES = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
const labels: Record<string, string> = { ...statusLabels, ditunda: "Ditunda", dibatalkan: "Dibatalkan" };
const dayMs = 86_400_000;

/** Whole days from creation to the `selesai` history entry; a dash when the instruction is not finished. */
export function daysToFinish(item: Pick<Instruction, "createdAt" | "history">): string {
  const done = [...item.history].reverse().find((entry) => entry.status === "selesai");
  const start = Date.parse(item.createdAt);
  const end = done ? Date.parse(done.at) : NaN;
  return Number.isFinite(start) && Number.isFinite(end) ? String(Math.max(0, Math.floor((end - start) / dayMs))) : "–";
}

const shortDate = (iso: string) => iso.split("-").reverse().join("-");

export function recapRows(items: Instruction[]): RecapRow[] {
  return items.map((item) => ({
    code: item.id, date: shortDate(item.reportDate), title: item.itemTitle, pic: item.pic.join(", ") || "–",
    status: labels[item.status] ?? item.status, days: daysToFinish(item),
  }));
}

export const monthTitle = (bulan: string) => `${MONTH_NAMES[Number(bulan.slice(5, 7)) - 1]} ${bulan.slice(0, 4)}`;

export async function buildTaskRecapPdf(bulan: string, items: Instruction[]): Promise<Uint8Array> {
  const p = new PdfPainter({ marginX: 40, marginTop: 28, marginBottom: 28 });
  await p.init();
  p.footerLabel = `Rekap Arahan Direktur ${monthTitle(bulan)}`;
  p.drawHospitalKop();
  p.drawCenteredText(`Rekap Arahan Direktur ${monthTitle(bulan)}`, 12, p.bold);
  p.gap(8);
  const rows = recapRows(items);
  const widths = [50, 54, 0, 100, 72, 34];
  widths[2] = p.contentW - widths.reduce((sum, w) => sum + w, 0);
  const head = ["KODE", "TANGGAL", "JUDUL", "PIC", "STATUS", "HARI"];
  const header = () => p.drawTableRow(head.map((text, i) => ({ text, width: widths[i], header: true })), 16);
  header();
  for (const row of rows) {
    const cells = [row.code, row.date, row.title, row.pic, row.status, row.days];
    const lines = Math.max(...cells.map((text, i) => wrapText(p.font, text, 7.5, widths[i] - 6).length), 1);
    const height = Math.min(Math.max(20, lines * 9 + 8), 80);
    if (p.y - height - 2 < p.marginBottom + 12) { p.newPage(); header(); }
    p.drawTableRow(cells.map((text, i) => ({ text, width: widths[i] })), height);
  }
  if (!rows.length) p.drawWrapped("Tidak ada arahan pada bulan ini.", 9, p.italic, COLORS.muted);
  p.gap(10);
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.status, (counts.get(row.status) ?? 0) + 1);
  p.drawWrapped(`Jumlah arahan: ${rows.length}. ${[...counts].map(([status, n]) => `${status}: ${n}`).join(" | ")}`, 8.5, p.bold);
  p.gap(16);
  p.drawWrapped("Direktur RSIA Melinda DHAI", 9);
  p.gap(32);
  p.drawWrapped(SIGNATORY, 9, p.bold);
  return p.save();
}
