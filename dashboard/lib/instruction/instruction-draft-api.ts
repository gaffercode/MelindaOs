import { callClaude, requireClaudeKey } from "../claude-client";
import { wibDate } from "../director/director-data";
import { DirectorApiError, jsonResponse, objectBody, rateLimit, readBoundedJson, requireConfiguration, requireHuman } from "../director/director-api";
import { logError } from "../log";
import { findPatientIdentifiers, identifierLabels } from "../phi-guard";
import { DRAFT_LIMIT, NOTE_LIMIT, draftSchema, parseDrafts } from "./instruction-draft";

const BODY_LIMIT = 12 * 1024;
const CONTEXT_LIMIT = 60;
const NOTE_CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const failed = "Asisten AI belum dapat meringkas. Coba lagi.";

const system = [
  "Kamu membantu Direktur RSIA Melinda DHAI Kediri mengubah catatannya menjadi arahan terpisah untuk staf.",
  "Pecah menjadi beberapa arahan hanya bila catatan memuat tugas yang berbeda; satu tugas = satu arahan.",
  `Paling banyak ${DRAFT_LIMIT} arahan.`,
  "Pertahankan fakta, nama, angka, dan tanggal dari Direktur apa adanya. Jangan menambah fakta, nama, angka, tenggat, atau tujuan baru. Jangan mengubah maksud.",
  "title: perihal singkat, maks. 300 karakter. note: isi arahan dalam Bahasa Indonesia baku yang ringkas dan sopan, maks. 280 karakter.",
  "action: approve (setujui), request_update (minta update), assign (tugaskan), escalate (eskalasi), defer (tunda), done (tandai selesai).",
  "pic: tujuan hanya dari kata di catatan (jabatan, nama, unit, atau tim); maks. 8, tiap tujuan maks. 60 karakter; kosongkan bila catatan tidak menyebut tujuan.",
  "deadline: hanya bila catatan menyebut tenggat, format YYYY-MM-DDTHH:mm WIB, hitung tanggal relatif (besok, Jumat) dari tanggal hari ini; selain itu null. Tenggat hanya untuk request_update atau escalate.",
  "urgent: true hanya bila catatan menyatakan mendesak atau segera.",
  "Hapus identitas pasien (nama, No. RM, NIK, tanggal lahir) bila ada.",
].join("\n");

function weekday(date: string): string {
  return new Intl.DateTimeFormat("id-ID", { timeZone: "Asia/Jakarta", weekday: "long" }).format(new Date(`${date}T12:00:00+07:00`));
}

export async function draftInstructions(request: Request): Promise<Response> {
  const { config, reviewerId } = await requireHuman(request, requireConfiguration(), true);
  requireClaudeKey();
  const body = objectBody(await readBoundedJson(request, BODY_LIMIT), ["note"], ["context"]);
  const note = typeof body.note === "string" ? body.note.trim() : "";
  if (!note || note.length > NOTE_LIMIT || NOTE_CONTROL.test(note)) throw new DirectorApiError(400, "Catatan kosong atau terlalu panjang.");
  const context = body.context === undefined ? "" : typeof body.context === "string" ? body.context.trim() : null;
  if (context === null || context.length > CONTEXT_LIMIT || NOTE_CONTROL.test(context) || /[\n\r\t]/.test(context)) throw new DirectorApiError(400, "Format permintaan tidak valid.");
  const identifiers = findPatientIdentifiers(note);
  if (identifiers.length) {
    logError("phi_blocked", { status: 422 });
    throw new DirectorApiError(422, `Catatan memuat data pasien (${identifiers.map((identifier) => identifierLabels[identifier]).join(", ")}). Hapus lalu coba lagi.`);
  }
  await rateLimit(config, `draft:${reviewerId}`, 30, 3600);
  const today = wibDate();
  const user = `Hari ini: ${today}, ${weekday(today)} (WIB). Halaman: ${context || "Dashboard"}.\n\nCatatan Direktur:\n${note}`;
  const text = await callClaude({ event: "ai_draft", system, user, maxTokens: 4000, schema: draftSchema });
  let parsed: unknown = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { logError("ai_draft_invalid", { status: 502 }); }
  const drafts = parseDrafts(parsed);
  if (!drafts.length) throw new DirectorApiError(502, failed);
  return jsonResponse({ drafts });
}
