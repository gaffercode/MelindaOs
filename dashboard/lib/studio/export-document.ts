import { createHash } from "node:crypto";
import { buildStructuredStudioPdf } from "../pdf/build-studio-structured";
import type { StudioDocument } from "./contracts";
import { buildStudioMarkdown } from "./build-markdown";
import { evaluateDocument } from "./evaluate-document";

export function documentFilename(doc: StudioDocument, format: "pdf" | "markdown"): string {
  const name = `${doc.kind}_${doc.title}`.normalize("NFKD").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 160);
  return `${name}.${format === "markdown" ? "md" : "pdf"}`;
}

/** Caller verifies the stored package's review and current source bindings before a final export. */
export async function exportDocument(doc: StudioDocument, mode: "preview" | "final"): Promise<{ pdf: Uint8Array; markdown: string; sha256: string }> {
  if (mode === "final") {
    const issues = evaluateDocument(doc, { sourceHashes: Object.fromEntries(doc.sources.map((s) => [s.id, s.sha256])), knownDocumentIds: [doc.id, ...doc.relatedDocumentIds], applicability: Object.fromEntries(doc.requirementIds.map((id) => [id, "applicable"])), phase: "final", reviewedRevisionHash: null });
    if (issues.some((i) => i.severity === "blocker")) throw new Error("Dokumen belum memenuhi aturan ekspor final.");
  }
  const pdf = await buildStructuredStudioPdf(doc, mode);
  const markdown = `${mode === "preview" ? "<!-- DRAF UNTUK KOREKSI -->\n" : ""}${buildStudioMarkdown(doc)}`;
  return { pdf, markdown, sha256: createHash("sha256").update(pdf).digest("hex") };
}
