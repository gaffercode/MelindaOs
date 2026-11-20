import type { DocumentBlock, StudioDocument } from "./contracts";
import { SIGNATORY } from "../pdf/pdf-kit";

const cell = (value: string) => value.replaceAll("\\", "\\\\").replaceAll("|", "\\|").replace(/\r?\n/g, "<br>");
function blockMarkdown(block: DocumentBlock): string {
  if (block.type === "text") return block.text;
  if (block.type === "list") return block.items.map((item, i) => `${i + 1}. ${item}`).join("\n");
  if (block.type === "input") return `${block.label}: ____________________`;
  return [`| ${block.headers.map(cell).join(" | ")} |`, `| ${block.headers.map(() => "---").join(" | ")} |`, ...block.rows.map((row) => `| ${row.map(cell).join(" | ")} |`)].join("\n");
}

export function buildStudioMarkdown(doc: StudioDocument): string {
  const q = JSON.stringify;
  const title = doc.title.replaceAll("\n", " ");
  return ["---", `doc_id: ${q(`kb-operasional-${doc.id}`)}`, `title: ${q(doc.title)}`, "domain: Operasional", `department: ${q(doc.unit)}`, `version: ${q(doc.revision)}`, `last_reviewed: ${q(doc.issueDate ?? new Date().toISOString().slice(0, 10))}`, "ftdr_safety_override: false", "tags: [studio, akreditasi]", "---", "", `# ${title}`, "", "## Identitas Dokumen", "", "| Butir | Isi |", "| --- | --- |", `| Nomor | ${cell(doc.number ?? "")} |`, `| Revisi | ${cell(doc.revision)} |`, `| Tanggal penetapan | ${cell(doc.issueDate ?? "")} |`, `| Unit | ${cell(doc.unit)} |`, "",
    ...doc.sections.flatMap((section) => [`## ${section.heading}`, "", ...section.blocks.flatMap((block) => [blockMarkdown(block), ""])]),
    "## Pengesahan", "", "Ditetapkan di Kediri.", `Tanggal: ${doc.issueDate ?? ""}`, "", doc.authority === "director" ? "Direktur RSIA Melinda DHAI" : "Pemilik RSIA Melinda DHAI", "", "Tanda tangan: ____________________", "", doc.authority === "director" ? SIGNATORY : "", ""].join("\n");
}
