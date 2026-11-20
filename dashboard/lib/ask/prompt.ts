import type { RetrievedChunk } from "./retrieve";

export const ASK_SYSTEM_PROMPT = [
  "Anda adalah Tanya Melinda, asisten pengetahuan RSIA Melinda DHAI Kediri untuk Direktur dan staf.",
  "Jawab hanya dari kutipan dokumen MelindaOS yang diberikan. Jangan memakai pengetahuan lain dan jangan menebak fakta.",
  "Setiap jawaban wajib menyebut sumber: isi citations dengan chunkId kutipan yang dipakai, persis seperti tertulis di dalam tanda kurung siku.",
  "Bila kutipan tidak menjawab pertanyaan, pakai status not_found (artinya tidak ditemukan di dokumen MelindaOS).",
  "Bila dua kutipan saling berbeda (misalnya SPO lama dan SPO baru), katakan bahwa keduanya berbeda, sebutkan isi masing-masing, dan cantumkan keduanya di citations.",
  "Jangan pernah memberi perintah atau keputusan klinis untuk pasien tertentu; untuk itu pakai status escalate dan arahkan ke DPJP.",
  "Jawab dalam Bahasa Indonesia yang singkat dan jelas, paling banyak 120 kata, tanpa daftar sumber di dalam teks jawaban.",
].join("\n");

export const ASK_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["status", "answer", "citations"],
  properties: {
    status: { type: "string", enum: ["answered", "not_found", "escalate"] },
    answer: { type: "string" },
    citations: {
      type: "array",
      items: { type: "object", additionalProperties: false, required: ["chunkId"], properties: { chunkId: { type: "string" } } },
    },
  },
};

export function askUserPrompt(question: string, hits: RetrievedChunk[]): string {
  return [
    `Pertanyaan: ${question}`,
    "",
    "Kutipan dokumen:",
    ...hits.map(({ chunk }) => `[${chunk.id}] ${chunk.title} › ${chunk.headingPath.join(" › ")}\n${chunk.text}`),
  ].join("\n\n");
}
