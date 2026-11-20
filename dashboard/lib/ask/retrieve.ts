import { createHash } from "node:crypto";
import MiniSearch, { type AsPlainObject, type Options } from "minisearch";
import type { KnowledgeChunk } from "@/lib/contracts";
import { STOPWORDS_ID } from "./stopwords-id.ts";

/** Noise floor for a hit's BM25 score. */
export const ASK_MIN_SCORE = 4;
/**
 * A hit supports an answer when it matches (exactly or as a prefix; typo matches do not count) at least
 * ASK_MIN_MATCHED distinct question terms, or at least ASK_MIN_COVERAGE of them. Raw BM25 scores on the real
 * corpus overlap between on- and off-topic questions (one shared word such as "jadwal" scores ~48), so the
 * matched-term rule is what keeps "jadwal kereta ke Surabaya" (1 term) out while long staff questions get in.
 */
export const ASK_MIN_MATCHED = 2;
export const ASK_MIN_COVERAGE = 0.5;
/** One document with a strongly matching title must not fill every slot the answerer sees. */
const MAX_PER_DOCUMENT = 2;

export type RetrievedChunk = { chunk: KnowledgeChunk; score: number; matched: number; coverage: number };

export interface Retriever {
  search(question: string, limit?: number): RetrievedChunk[];
}

const processTerm = (term: string) => {
  const lower = term.toLowerCase();
  return STOPWORDS_ID.has(lower) ? null : lower;
};

const tokenize = MiniSearch.getDefault("tokenize") as (text: string) => string[];

const supports = (hit: RetrievedChunk) => hit.score >= ASK_MIN_SCORE && (hit.matched >= ASK_MIN_MATCHED || hit.coverage >= ASK_MIN_COVERAGE);

/** True when any retrieved hit is strong enough to send the question to the model. */
export function isAnswerable(hits: RetrievedChunk[]): boolean {
  return hits.some(supports);
}

const INDEX_OPTIONS: Options<KnowledgeChunk> = {
  fields: ["title", "headingPath", "text"],
  extractField: (chunk, field) => field === "headingPath" ? chunk.headingPath.join(" ") : String(chunk[field as keyof KnowledgeChunk]),
  processTerm,
  searchOptions: { boost: { title: 3, headingPath: 2 }, fuzzy: 0.15, prefix: true, processTerm },
};

// Full chunk JSON, not just ids: in live-repo mode an edited KB text keeps its ids, and a stale index must not load.
const chunksHash = (chunks: KnowledgeChunk[]) => createHash("sha256").update(JSON.stringify(chunks)).digest("hex");

function retrieverFor(chunks: KnowledgeChunk[], index: MiniSearch<KnowledgeChunk>): Retriever {
  const byId = new Map(chunks.map((chunk) => [chunk.id, chunk]));
  return {
    search(question, limit = 8) {
      const terms = [...new Set(tokenize(question).map(processTerm).filter((term): term is string => !!term))];
      if (!terms.length) return [];
      const perDocument = new Map<string, number>();
      const hits: RetrievedChunk[] = [];
      for (const hit of index.search(question)) {
        const chunk = byId.get(hit.id as string);
        const taken = chunk ? perDocument.get(chunk.path) ?? 0 : MAX_PER_DOCUMENT;
        if (!chunk || taken >= MAX_PER_DOCUMENT) continue;
        perDocument.set(chunk.path, taken + 1);
        const matched = terms.filter((term) => hit.terms.some((docTerm) => docTerm.startsWith(term))).length;
        hits.push({ chunk, score: hit.score, matched, coverage: matched / terms.length });
        if (hits.length >= limit) break;
      }
      return hits;
    },
  };
}

function buildIndex(chunks: KnowledgeChunk[]): MiniSearch<KnowledgeChunk> {
  const index = new MiniSearch<KnowledgeChunk>(INDEX_OPTIONS);
  index.addAll(chunks);
  return index;
}

export function buildRetriever(chunks: KnowledgeChunk[]): Retriever {
  return retrieverFor(chunks, buildIndex(chunks));
}

/** Build-time index, tied to the exact chunk list (count and full content) so a stale file is never used. */
export function serializeSearchIndex(chunks: KnowledgeChunk[]): string {
  return JSON.stringify({ chunkCount: chunks.length, chunksHash: chunksHash(chunks), index: buildIndex(chunks) });
}

/** Retriever from serializeSearchIndex output; null when the file is invalid or was built for other chunks. */
export function loadRetriever(chunks: KnowledgeChunk[], serialized: string): Retriever | null {
  try {
    const parsed = JSON.parse(serialized) as { chunkCount?: unknown; chunksHash?: unknown; index?: unknown };
    if (parsed.chunkCount !== chunks.length || parsed.chunksHash !== chunksHash(chunks) || !parsed.index) return null;
    return retrieverFor(chunks, MiniSearch.loadJS(parsed.index as AsPlainObject, INDEX_OPTIONS));
  } catch {
    return null;
  }
}
