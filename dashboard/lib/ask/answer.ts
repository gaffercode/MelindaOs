import type { callClaude } from "../claude-client";
import { DirectorApiError } from "../director/director-api";
import { findPatientIdentifiers } from "../phi-guard";
import { ASK_SCHEMA, ASK_SYSTEM_PROMPT, askUserPrompt } from "./prompt";
import { isAnswerable, type Retriever } from "./retrieve";

export type AskStatus = "answered" | "not_found" | "escalate";
export type AskSource = { docId: string; title: string; heading: string; path: string };
export type AskResult = { status: AskStatus; answer: string; sources: AskSource[] };

export const ASK_MAX_QUESTION = 500;
export const ASK_NOT_FOUND = "Tidak ditemukan di dokumen MelindaOS.";
export const ASK_ESCALATE_PHI = "Pertanyaan menyebut identitas pasien. Silakan tanyakan langsung ke DPJP.";
export const ASK_UNAVAILABLE = "Tanya Melinda sedang tidak tersedia.";

const notFound = (): AskResult => ({ status: "not_found", answer: ASK_NOT_FOUND, sources: [] });

/** Answers only from retrieved MelindaOS chunks; citations outside the retrieved set are dropped. */
export async function ask(question: string, deps: { retriever: Retriever; call: typeof callClaude }): Promise<AskResult> {
  const trimmed = question.trim();
  if (!trimmed) throw new DirectorApiError(400, "Pertanyaan masih kosong.");
  if (trimmed.length > ASK_MAX_QUESTION) throw new DirectorApiError(400, `Pertanyaan terlalu panjang (maksimal ${ASK_MAX_QUESTION} karakter).`);
  if (findPatientIdentifiers(trimmed).length) return { status: "escalate", answer: ASK_ESCALATE_PHI, sources: [] };

  const hits = deps.retriever.search(trimmed, 8);
  if (!isAnswerable(hits)) return notFound();

  let reply: string | null;
  try {
    reply = await deps.call({
      // 4000 matches ai_draft: on claude-haiku-5-5 adaptive thinking spends from the same budget, so 700 hit max_tokens before the JSON finished (2026-11-08).
      event: "ai_ask", system: ASK_SYSTEM_PROMPT, user: askUserPrompt(trimmed, hits), maxTokens: 4000, schema: ASK_SCHEMA,
      model: process.env.MELINDAOS_ASK_MODEL?.trim() || undefined,
    });
  } catch {
    throw new DirectorApiError(503, ASK_UNAVAILABLE);
  }
  let parsed: { status?: unknown; answer?: unknown; citations?: unknown };
  try { parsed = JSON.parse(reply ?? "") as typeof parsed; } catch { throw new DirectorApiError(503, ASK_UNAVAILABLE); }
  if (!parsed || typeof parsed !== "object" || typeof parsed.answer !== "string") throw new DirectorApiError(503, ASK_UNAVAILABLE);

  const retrieved = new Map(hits.map(({ chunk }) => [chunk.id, chunk]));
  const cited = Array.isArray(parsed.citations)
    ? [...new Set(parsed.citations.map((citation: { chunkId?: unknown }) => citation?.chunkId).filter((id): id is string => typeof id === "string" && retrieved.has(id)))]
    : [];
  const sources = cited.map((id) => {
    const chunk = retrieved.get(id)!;
    return { docId: chunk.docId, title: chunk.title, heading: chunk.headingPath.join(" › "), path: chunk.path };
  });

  if (parsed.status === "escalate") return { status: "escalate", answer: parsed.answer.trim(), sources };
  if (parsed.status !== "answered" || !sources.length) return notFound();
  return { status: "answered", answer: parsed.answer.trim(), sources };
}
