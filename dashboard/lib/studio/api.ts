import { protectedDirectorMode } from "../director/director-auth";
import { DirectorApiError, requireConfiguration, requireHuman } from "../director/director-api";
import type { DocumentBlock, StudioDocument } from "./contracts";
import type { StudioActor } from "./store";

export async function studioActor(request: Request, write = false): Promise<StudioActor> {
  if (!protectedDirectorMode()) return { role: "director", reviewerId: "local-dev" };
  const human = await requireHuman(request, requireConfiguration(), write);
  return { role: human.role, reviewerId: human.reviewerId };
}

export function boundedText(value: unknown, limit = 500): string {
  if (typeof value !== "string" || !value.trim() || value.length > limit) throw new DirectorApiError(400, "Isian teks tidak valid.");
  return value;
}
export function expectedRevision(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) throw new DirectorApiError(400, "Revisi paket tidak valid.");
  return value;
}
export function packageId(value: string): string {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value)) throw new DirectorApiError(400, "ID paket tidak valid.");
  return value;
}
function obj(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new DirectorApiError(400, "Struktur dokumen tidak valid.");
  return value as Record<string, unknown>;
}
function strings(value: unknown, max: number): string[] {
  if (!Array.isArray(value) || value.length > max || value.some((v) => typeof v !== "string" || v.length > 20_000)) throw new DirectorApiError(400, "Isi dokumen melebihi batas.");
  return value;
}
function block(value: unknown): DocumentBlock {
  const b = obj(value);
  if (b.type === "text") return { type: "text", text: typeof b.text === "string" && b.text.length <= 40_000 ? b.text : boundedText(b.text, 40_000) };
  if (b.type === "list") return { type: "list", items: strings(b.items, 200) };
  if (b.type === "input" && (b.purpose === "operational" || b.purpose === "signature")) return { type: "input", label: boundedText(b.label), purpose: b.purpose };
  if (b.type === "table" && Array.isArray(b.rows) && b.rows.length <= 500) return { type: "table", headers: strings(b.headers, 12), rows: b.rows.map((r) => strings(r, 12)) };
  throw new DirectorApiError(400, "Jenis isi dokumen tidak valid.");
}

/** Only editorial fields can change; source/authority/number/EP assignments remain server-owned. */
export function editedDocuments(value: unknown, current: StudioDocument[]): StudioDocument[] {
  if (!Array.isArray(value) || value.length !== current.length) throw new DirectorApiError(400, "Daftar dokumen paket tidak valid.");
  const ids = value.map((v) => obj(v).id);
  if (new Set(ids).size !== current.length) throw new DirectorApiError(400, "ID dokumen harus unik.");
  return current.map((doc) => {
    const raw = obj(value.find((v) => obj(v).id === doc.id));
    if (!Array.isArray(raw.sections) || raw.sections.length > 50) throw new DirectorApiError(400, "Bagian dokumen tidak valid.");
    const sections = raw.sections.map((value) => {
      const s = obj(value);
      if (!Array.isArray(s.blocks) || s.blocks.length > 100) throw new DirectorApiError(400, "Isi bagian tidak valid.");
      return { id: boundedText(s.id, 100), heading: boundedText(s.heading), blocks: s.blocks.map(block) };
    });
    return { ...doc, title: boundedText(raw.title), unit: boundedText(raw.unit), sections };
  });
}
