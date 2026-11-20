import { buildFormPdf, type StudioFormData } from "./build-studio-form";
import { buildSkPdf, type StudioSkData } from "./build-studio-sk";
import { buildSpoPdf, type StudioSpoData } from "./build-studio-spo";

export type StudioDocType = "spo" | "sk" | "form";

export async function buildStudioPdf(docType: StudioDocType, data: unknown): Promise<Uint8Array> {
  const payload = data && typeof data === "object" && !Array.isArray(data) ? data : {};
  if (docType === "spo") return buildSpoPdf(payload as StudioSpoData);
  if (docType === "sk") return buildSkPdf(payload as StudioSkData);
  if (docType === "form") return buildFormPdf(payload as StudioFormData);
  throw new Error(`docType tidak didukung: ${docType}`);
}
