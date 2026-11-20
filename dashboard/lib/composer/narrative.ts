import { callClaude } from "../claude-client";
import { logError, logInfo } from "../log";
import { findPatientIdentifiers } from "../phi-guard";
import { CONTROL } from "./compose";
import type { Fact } from "./facts";
import { allowedNumbers, decisionCode, isGrounded } from "./grounding";

export type Narrative = {
  serviceSummary: string | null; safetyQuality: string | null; pharmacy: string | null; staffing: string | null;
  decisions: { kode: string; keputusan: string; rekomendasi: string }[];
  conclusion: string[];
};

export const BRIEF_MODEL = "claude-opus-5-5";
export const briefModel = (): string => process.env.MELINDAOS_BRIEF_MODEL?.trim() || BRIEF_MODEL;

const TEXT_LIMIT = 600;
const MAX_DECISIONS = 5;
const MAX_CONCLUSION = 3;

// The API rejects length and array-size keywords in a schema, so the limits live in the prompt and in `writeNarrative`.
const text = { type: "string" };
const decision = {
  type: "object", additionalProperties: false, required: ["factId", "keputusan", "rekomendasi"],
  properties: { factId: { type: "string" }, keputusan: { type: "string" }, rekomendasi: { type: "string" } },
};
const schema = {
  type: "object", additionalProperties: false, required: ["serviceSummary", "safetyQuality", "pharmacy", "staffing", "decisions", "conclusion"],
  properties: {
    serviceSummary: text, safetyQuality: text, pharmacy: text, staffing: text,
    decisions: { type: "array", items: decision },
    conclusion: { type: "array", items: text },
  },
};

// Each rule carries its reason: the program checks every number and name afterwards, and a failing paragraph is thrown away.
const system = [
  "Kamu menulis ringkasan manajemen harian untuk Direktur rumah sakit. Tulis dalam Bahasa Indonesia baku, kalimat pendek dan lugas, huruf kapital hanya di awal kalimat dan nama diri.",
  "Pakai hanya fakta pada pesan pengguna. Jangan menambah fakta, penyebab, atau dugaan, karena program memeriksa setiap kalimat terhadap fakta itu dan membuang paragraf yang menyimpang.",
  "Setiap fakta bertanda bagian. Tulis tiap bagian hanya dari fakta bertanda bagian itu, karena program memeriksa angka tiap paragraf terhadap fakta bagiannya sendiri dan membuang paragraf yang memuat angka dari bagian lain. Bagian yang punya fakta wajib diisi.",
  "Sebut periode setiap angka seperti tertulis di fakta (misalnya \"hari lengkap terakhir\", \"dalam sebulan terakhir\", \"saat data diambil\"), dan jangan menghubungkan angka harian dengan angka periode lain sebagai sebab-akibat, karena periodenya berbeda.",
  "Angka yang ditandai sementara harus disebut sementara; jangan menyebutnya naik atau turun dan jangan menjadikannya dasar keputusan, karena angkanya masih berubah.",
  "Aturan angka, karena pemeriksa hanya membaca angka berupa digit:",
  "- Tulis setiap angka sebagai digit yang disalin persis, karakter demi karakter, dari teks fakta (misalnya \"1.300\" atau \"91,2\"); bentuk lain seperti \"1,300\" atau \"1 300\" ditolak.",
  "- Jangan pernah menulis bilangan dengan kata (\"sepertiga\", \"dua kali lipat\", \"delapan puluh persen\"), karena pemeriksa tidak dapat menilainya.",
  "- Jangan memakai ribu, juta, miliar, rb, jt, atau penulisan seperti \"x10\", karena hanya angka di depannya yang diperiksa.",
  "- Jangan menghitung sendiri: tidak ada selisih, jumlah, rata-rata, persentase, atau perbandingan baru. Bila fakta tidak memuat suatu angka, jangan menyebut angka itu.",
  "- Jangan menulis jam, urutan (ke-2, kedua), maupun tanggal; Direktur sudah tahu tanggal ringkasan ini.",
  "Jangan menulis id fakta atau kode keputusan di dalam teks; kode ditambahkan oleh program.",
  "Jangan menulis nama atau identitas pasien (nama, No. RM, NIK, tanggal lahir), karena ringkasan ini membahas angka manajemen rumah sakit, bukan pasien perorangan, dan program membuang paragraf yang tampak seperti data pasien.",
  "Isi: serviceSummary (layanan: tempat tidur, kunjungan, pasien masuk, indikator bulanan), safetyQuality (mutu dan keselamatan: NDR, GDR, SATUSEHAT, penunjang, keterbatasan data), pharmacy (tampil di bagian Klaim & keuangan: penjamin dan farmasi), staffing (kepegawaian); masing-masing paling banyak 600 karakter, dan paragraf yang lebih panjang dibuang. Dahulukan fakta dengan severity perhatian atau kritis, lalu pilih yang paling berarti bagi Direktur; tidak perlu menyebut semua fakta. Bila tidak ada fakta untuk satu bagian, isi dengan string kosong; jangan mengarang.",
  "decisions: paling banyak 5 usulan keputusan untuk Direktur, dahulukan fakta dengan severity perhatian atau kritis. Tiap usulan bersandar pada tepat satu fakta; isi factId dengan id fakta itu persis seperti di daftar, dan angka di dalamnya hanya boleh dari fakta itu. keputusan: satu kalimat yang menyebut hal yang perlu diputuskan, diawali kata kerja seperti \"Menetapkan\", \"Menugaskan\", atau \"Meninjau\"; jangan menulis seolah Direktur sudah meminta atau memutuskan, karena ini baru usulan. rekomendasi: satu kalimat langkah pelaksanaan. Bila tidak ada yang layak, kosongkan daftar.",
  "conclusion: 2 atau 3 kalimat penutup, masing-masing paling banyak 600 karakter. Jangan menyatakan suatu data tidak tersedia kecuali ada fakta yang mengatakannya.",
].join("\n");

type ParagraphKey = "serviceSummary" | "safetyQuality" | "pharmacy" | "staffing";
/** The reply key each fact is written under: section 04 is the "pharmacy" paragraph, and data limitations belong to quality. */
const REPLY_KEY: Record<Fact["section"], ParagraphKey> = { serviceSummary: "serviceSummary", safetyQuality: "safetyQuality", claimsFinance: "pharmacy", staffing: "staffing", dataLimitations: "safetyQuality" };

type Reply = { serviceSummary: string; safetyQuality: string; pharmacy: string; staffing: string; decisions: { factId: string; keputusan: string; rekomendasi: string }[]; conclusion: string[] };

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isText = (value: unknown): value is string => typeof value === "string";
const isDecision = (value: unknown): value is Reply["decisions"][number] =>
  isRecord(value) && typeof value.factId === "string" && typeof value.keputusan === "string" && typeof value.rekomendasi === "string";

function parseReply(raw: string): Reply | null {
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return null; }
  if (!isRecord(value)) return null;
  const { serviceSummary, safetyQuality, pharmacy, staffing, decisions, conclusion } = value;
  if (!isText(serviceSummary) || !isText(safetyQuality) || !isText(pharmacy) || !isText(staffing)) return null;
  if (!Array.isArray(decisions) || !decisions.every(isDecision)) return null;
  if (!Array.isArray(conclusion) || !conclusion.every(isText)) return null;
  return { serviceSummary, safetyQuality, pharmacy, staffing, decisions, conclusion };
}

/**
 * Asks Claude to write the brief's prose about the given facts, then keeps only what passes the length, control-character, number and
 * patient-identifier checks (at most 5 decisions and 3 conclusion lines). A paragraph may state only numbers from its own section's facts,
 * a decision only numbers from the fact it cites, and a conclusion line numbers from any fact. Returns null on any failure.
 */
export async function writeNarrative(facts: Fact[]): Promise<Narrative | null> {
  let raw: string | null;
  try {
    raw = await callClaude({
      event: "ai_brief", system, user: JSON.stringify(facts.map(({ id, section, text, severity }) => ({ id, bagian: REPLY_KEY[section], text, severity }))),
      maxTokens: 16000, timeoutMs: 120_000, logUsage: true, fallbacks: "default", model: briefModel(), schema,
    });
  } catch (error) {
    logError("ai_brief_failed", error);
    return null;
  }
  const reply = raw === null ? null : parseReply(raw);
  if (!reply) {
    if (raw !== null) logError("ai_brief_invalid", null);
    return null;
  }
  const passes = (line: string, source: Fact[]) => line.length <= TEXT_LIMIT && !CONTROL.test(line) && isGrounded(line, allowedNumbers(source)) && findPatientIdentifiers(line).length === 0;
  const checked = (line: string, source: Fact[]) => (line.trim() !== "" && passes(line, source) ? line.trim() : null);
  const paragraph = (key: ParagraphKey) => checked(reply[key], facts.filter((fact) => REPLY_KEY[fact.section] === key));
  const known = new Map(facts.map((fact) => [fact.id, fact]));
  const kept = new Set<string>();
  const decisions: Narrative["decisions"] = [];
  for (const { factId, keputusan, rekomendasi } of reply.decisions) {
    if (decisions.length === MAX_DECISIONS) break;
    const cited = known.get(factId);
    if (!cited || kept.has(factId) || keputusan.trim() === "" || !passes(keputusan, [cited]) || !passes(rekomendasi, [cited])) continue;
    kept.add(factId);
    decisions.push({ kode: decisionCode(factId), keputusan: keputusan.trim(), rekomendasi: rekomendasi.trim() });
  }
  const paragraphs = [reply.serviceSummary, reply.safetyQuality, reply.pharmacy, reply.staffing];
  const [serviceSummary, safetyQuality, pharmacy, staffing] = [paragraph("serviceSummary"), paragraph("safetyQuality"), paragraph("pharmacy"), paragraph("staffing")];
  const conclusion = reply.conclusion.flatMap((line) => checked(line, facts) ?? []).slice(0, MAX_CONCLUSION);
  // Counts only. A blank paragraph or conclusion line counts as neither; an item past a cap counts as dropped.
  const written = (lines: string[]) => lines.filter((line) => line.trim() !== "").length;
  const paragraphsKept = [serviceSummary, safetyQuality, pharmacy, staffing].filter((line) => line !== null).length;
  logInfo("ai_brief_checked", {
    paragraphsKept, paragraphsDropped: written(paragraphs) - paragraphsKept,
    decisionsKept: decisions.length, decisionsDropped: reply.decisions.length - decisions.length,
    conclusionKept: conclusion.length, conclusionDropped: written(reply.conclusion) - conclusion.length,
  });
  return { serviceSummary, safetyQuality, pharmacy, staffing, decisions, conclusion };
}
