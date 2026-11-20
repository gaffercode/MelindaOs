import { COLORS, PdfPainter, wrapText } from "./pdf-kit";

export type KitField = { label: string; type: "text" | "date" | "check" | "signature" };
export type Kit = {
  epId: string;
  regulation: { docIds: string[]; studioPresetCodes: string[] };
  form: { title: string; fields: KitField[] } | null;
  photoChecklist: string[] | null;
  practice: { role: string; question: string; keyAnswer: string }[] | null;
};

const ANSWER: Record<KitField["type"], string> = { text: "", date: "…… / …… / 20……", check: "[  ] Ya    [  ] Tidak", signature: "" };
const epLabel = (epId: string) => epId.replace(/^47104-2024:/, "").replace(/:(\d+)$/, " EP $1").replace(":", " ");

function table(p: PdfPainter, heading: string, rows: [string, string][]) {
  const widths = [26, 300, p.contentW - 326];
  p.drawTableRow([{ text: "NO", width: widths[0], header: true }, { text: heading.toUpperCase(), width: widths[1], header: true }, { text: "ISIAN", width: widths[2], header: true }], 16);
  rows.forEach(([item, answer], index) => {
    const lines = Math.max(wrapText(p.font, item, 8, widths[1] - 6).length, 1);
    p.drawTableRow([{ text: String(index + 1), width: widths[0] }, { text: item, width: widths[1] }, { text: answer, width: widths[2] }], Math.max(26, lines * 10 + 10));
  });
  p.gap(10);
}

/**
 * One blank evidence form per D-EP (one page each), then the chapter's photo checklists and interview practice.
 * All pages share one document and its fonts; nothing is pre-filled and there is no patient identity box.
 */
export async function buildStarkesKitPdf(kits: Kit[], chapter: string): Promise<Uint8Array> {
  const p = new PdfPainter({ marginX: 40, marginTop: 28, marginBottom: 28 });
  await p.init();
  p.footerLabel = `Kit bukti STARKES ${chapter}`;
  let first = true;
  const startPage = () => { if (!first) p.newPage(); first = false; p.drawHospitalKop(); };

  for (const kit of kits) {
    if (!kit.form) continue;
    startPage();
    p.drawCenteredText(kit.form.title, 11.5, p.bold);
    p.drawCenteredText(`${epLabel(kit.epId)} | Instrumen STARKES 47104/2024`, 9, p.italic, COLORS.muted);
    p.gap(8);
    table(p, "Bukti pelaksanaan", kit.form.fields.map((f) => [f.label, ANSWER[f.type]]));
    p.drawCenteredText("Isi dengan pulpen, pindai, lalu simpan di folder Google Drive bab ini.", 8, p.italic, COLORS.muted);
  }

  const checklists = kits.filter((k) => k.photoChecklist || k.practice);
  if (checklists.length) {
    startPage();
    p.drawCenteredText(`Checklist foto dan latihan wawancara ${chapter}`, 12, p.bold);
    p.gap(8);
    for (const kit of checklists) {
      if (kit.photoChecklist) table(p, `${epLabel(kit.epId)} checklist foto`, kit.photoChecklist.map((item) => [item, "[  ] Ya    [  ] Tidak"]));
      for (const q of kit.practice ?? []) table(p, `${epLabel(kit.epId)} latihan wawancara`, [[`${q.role}: ${q.question}`, ""], [`Kunci: ${q.keyAnswer}`, ""]]);
    }
  }
  return p.save();
}
