import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { callClaude } from "../claude-client";
import { DirectorApiError, jsonResponse, objectBody, readBoundedJson } from "../director/director-api";
import type { KnowledgeChunk } from "../contracts";
import { loadKnowledgeChunks } from "../repository";
import { ASK_UNAVAILABLE, ask } from "./answer";
import { buildRetriever, loadRetriever, type Retriever } from "./retrieve";

// loadKnowledgeChunks caches its array, so the index is loaded (or built) once per server instance.
const retrievers = new WeakMap<KnowledgeChunk[], Retriever>();

/** The index written by scripts/build-knowledge-index.ts; null (build it here instead) when missing or stale. */
async function prebuiltRetriever(chunks: KnowledgeChunk[]): Promise<Retriever | null> {
  try { return loadRetriever(chunks, await readFile(join(process.cwd(), "data", "knowledge-search-index.json"), "utf8")); } catch { return null; }
}

export async function sharedRetriever(): Promise<Retriever> {
  let chunks: KnowledgeChunk[];
  try { chunks = await loadKnowledgeChunks(); } catch { throw new DirectorApiError(503, ASK_UNAVAILABLE); }
  let retriever = retrievers.get(chunks);
  if (!retriever) { retriever = (await prebuiltRetriever(chunks)) ?? buildRetriever(chunks); retrievers.set(chunks, retriever); }
  return retriever;
}

/** Body of the ask route: one question, no other field. */
export async function answerRequest(request: Request): Promise<Response> {
  const body = objectBody(await readBoundedJson(request, 8192), ["question"]);
  if (typeof body.question !== "string") throw new DirectorApiError(400, "Pertanyaan wajib berupa teks.");
  return jsonResponse(await ask(body.question, { retriever: await sharedRetriever(), call: callClaude }));
}
