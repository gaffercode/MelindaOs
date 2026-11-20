export type ValidationCategory = "A" | "B" | "C";

export interface ValidationCount {
  category: ValidationCategory;
  passed: number;
  total: number;
}

export interface ValidationSnapshot {
  status: "available" | "unavailable";
  scannedAt: string;
  counts: ValidationCount[];
  passed: number;
  total: number;
  limitation: string;
  error?: string;
  /** "live" = fresh checker run; "snapshot" = committed/generated file served because the scan was unavailable. */
  source?: "live" | "snapshot";
}

/** One placeholder the readiness engine filled, from knowledge/12_GOVERNANCE/knowledge/readiness-provenance.jsonl. */
export interface AiFill {
  placeholder: string;
  value: string;
  method: string;
  sourceRef: string;
}

export interface KnowledgeDocument {
  path: string;
  category: ValidationCategory;
  title: string;
  docId: string;
  domain: string;
  department: string;
  lastReviewed: string;
  tags: string[];
  searchableText: string;
  aiFills?: AiFill[];
}

/** One `##`/`###` section of an approved category A document; `id` is `${docId}#${slug(headingPath)}`. */
export interface KnowledgeChunk {
  id: string;
  docId: string;
  path: string;
  title: string;
  headingPath: string[];
  text: string;
}

export interface SearchResult extends Omit<KnowledgeDocument, "searchableText"> {
  snippet: string;
  /** `full`: every query word appears as typed and matches whole words (or their prefixes). `partial`: nearest results only. */
  match: "full" | "partial";
}

export interface ProviderRecord {
  name: string;
  authStrategy: string;
  capabilities: string[];
  status: "declared";
}

export interface DashboardData {
  validation: ValidationSnapshot;
  providers: ProviderRecord[];
  documentCount: number;
}
