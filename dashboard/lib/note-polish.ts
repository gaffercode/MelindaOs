import { DirectorApiError, jsonResponse, objectBody, rateLimit, readBoundedJson, requireConfiguration, requireHuman } from "./director/director-api";
import { callClaude, requireClaudeKey } from "./claude-client";
import { logError } from "./log";
import { findPatientIdentifiers, identifierLabels } from "./phi-guard";

const limit = 280;
const instructions = [
  "Rapikan catatan arahan Direktur rumah sakit untuk staff.",
  "Gunakan Bahasa Indonesia baku yang ringkas, jelas, dan sopan. Perbaiki ejaan dan susunan kalimat.",
  "Jangan menambah fakta, nama, angka, atau tenggat baru. Jangan mengubah maksud.",
  "Hapus identitas pasien bila ada.",
  `Maksimal ${limit} karakter. Balas hanya teks hasil, tanpa tanda kutip atau penjelasan.`,
].join(" ");

export function cleanPolished(value: string): string {
  return value.replace(/\s+/g, " ").trim().replace(/^["'“”]+|["'“”]+$/g, "").trim().slice(0, limit);
}

export async function polishNote(request: Request): Promise<Response> {
  const { config, reviewerId } = await requireHuman(request, requireConfiguration(), true);
  requireClaudeKey();
  const { note } = objectBody(await readBoundedJson(request, 2048), ["note"]);
  if (typeof note !== "string" || !note.trim() || note.length > limit) throw new DirectorApiError(400, "Catatan kosong atau terlalu panjang.");
  const identifiers = findPatientIdentifiers(note);
  if (identifiers.length) {
    logError("phi_blocked", { status: 422 });
    throw new DirectorApiError(422, `Catatan memuat data pasien (${identifiers.map((identifier) => identifierLabels[identifier]).join(", ")}). Hapus lalu coba lagi.`);
  }
  await rateLimit(config, `polish:${reviewerId}`, 30, 3600);
  const content = await callClaude({ event: "ai_polish", system: instructions, user: note.trim(), maxTokens: 800 });
  const polished = content ? cleanPolished(content) : "";
  if (!polished) throw new DirectorApiError(502, "Asisten AI belum dapat merapikan. Coba lagi.");
  return jsonResponse({ note: polished });
}
