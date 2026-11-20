export type DocumentKind = "sk" | "pedoman" | "program" | "spo" | "form" | "monitoring" | "materi";
export type Applicability = "applicable" | "not_applicable" | "unresolved";
export type SourceRef = { id: string; path: string; locator: string; sha256: string; reviewedAt: string; status: "verified" | "unresolved" | "superseded" };
export type DocumentBlock =
  | { type: "text"; text: string }
  | { type: "list"; items: string[] }
  | { type: "table"; headers: string[]; rows: string[][] }
  | { type: "input"; label: string; purpose: "operational" | "signature" };
export type StudioDocument = {
  id: string; kind: DocumentKind; title: string; unit: string; authority: "director" | "owner";
  revision: string; number: string | null; issueDate: string | null;
  sections: { id: string; heading: string; blocks: DocumentBlock[] }[];
  sources: SourceRef[]; requirementIds: string[]; relatedDocumentIds: string[];
};
export type StudioIssue = { code: string; documentId: string; field: string; severity: "blocker" | "warning"; message: string };
export type EvaluationContext = {
  sourceHashes: Record<string, string>; knownDocumentIds: string[]; applicability: Record<string, Applicability>;
  phase: "draft" | "final"; reviewedRevisionHash: string | null; actorAuthority?: "director" | "owner";
};

export type StudioPackage = {
  id: string; packageKey: string; revision: number;
  status: "draft" | "in_review" | "ready_for_signature" | "signed" | "superseded";
  baselineId: string; snapshotHash: string; applicabilityHash: string;
  applicability: Record<string, Applicability>; documents: StudioDocument[]; issues: StudioIssue[];
  requiredFactKeys: string[];
  review: { hash: string; reviewerId: string; reviewedAt: string } | null;
  finalizedHash?: string;
  finalization?: { requestId: string; issueDate: string; reviewHash: string };
  signature?: { evidenceRef: string; signedAt: string; confirmedBy: string };
};
