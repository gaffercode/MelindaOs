import { join } from "node:path";
import { authConfiguration, protectedDirectorMode } from "../director/director-auth";
import { DirectorStoreError } from "../director/director-store";
import { packageRevisionHash } from "./assemble-package";
import type { StudioPackage } from "./contracts";
import { FileStudioStore } from "./file-store";
import { checkFinalization, requireDirector, type FinalizationContext } from "./finalize-package";
import { loadStudioSourceSnapshot } from "./source-snapshot";
import { loadRequirementRegister } from "../starkes/requirements";
import seeds from "../../data/studio/numbering-seeds.json";
import { DirectorApiError } from "../director/director-api";

export type StudioActor = { role: "mutu" | "director"; reviewerId: string };
export interface StudioStore {
  create(pkg: StudioPackage, actor: StudioActor): Promise<StudioPackage>;
  get(id: string): Promise<StudioPackage>;
  list(): Promise<StudioPackage[]>;
  save(pkg: StudioPackage, expectedRevision: number, actor: StudioActor): Promise<StudioPackage>;
  review(id: string, expectedRevision: number, revisionHash: string, actor: StudioActor): Promise<StudioPackage>;
  finalize(id: string, expectedRevision: number, requestId: string, issueDate: string, actor: StudioActor): Promise<StudioPackage>;
  confirmSigned(id: string, expectedRevision: number, evidenceRef: string, signedAt: string, actor: StudioActor): Promise<StudioPackage>;
}

export function editableSnapshot(pkg: StudioPackage): StudioPackage {
  const result = structuredClone(pkg);
  result.status = "draft"; result.review = null; delete result.finalizedHash; delete result.finalization; delete result.signature;
  return result;
}

export function registeredSignature(ref: string, pkg: StudioPackage, signedAt: string): boolean {
  if (!pkg.finalizedHash || !ref.trim()) return false;
  try {
    const records: unknown = JSON.parse(process.env.MELINDAOS_STUDIO_SIGNATURE_REGISTER || "[]");
    return Array.isArray(records) && records.some((record) => record &&
      record.evidenceRef === ref && record.packageId === pkg.id &&
      record.finalizedHash === pkg.finalizedHash && record.signedAt === signedAt);
  } catch {
    return false;
  }
}

export async function finalizationContext(): Promise<FinalizationContext> {
  return { source: await loadStudioSourceSnapshot(), register: loadRequirementRegister(), series: structuredClone(seeds) as FinalizationContext["series"], verifyEvidenceRef: registeredSignature };
}

export function studioStore(): StudioStore {
  if (!protectedDirectorMode()) return new FileStudioStore(join(process.env.MELINDAOS_DIRECTOR_DATA_DIR || join(/*turbopackIgnore: true*/ process.cwd(), "data"), "studio-runtime"));
  const config = authConfiguration();
  if (!config) throw new DirectorStoreError(503, "configuration");
  const call = async <T>(command: string, args: Record<string, unknown>): Promise<T> => {
    const response = await config.store.call<{ result: T }>(command, args, "melinda_studio_documents");
    return response.result;
  };
  const store: StudioStore = {
    list: () => call("list", {}), get: (id) => call("get", { id }),
    create: (pkg, actor) => { const clean = editableSnapshot(pkg); clean.revision = 1;
      return call("create", { pkg: clean, contentHash: packageRevisionHash(clean), actor }); },
    save: (pkg, expectedRevision, actor) => { const clean = editableSnapshot(pkg); clean.revision = expectedRevision + 1;
      return call("save", { pkg: clean, contentHash: packageRevisionHash(clean), expectedRevision, actor }); },
    review: (id, expectedRevision, revisionHash, actor) => call("review", { id, expectedRevision, revisionHash, actor }),
    finalize: async (id, expectedRevision, requestId, issueDate, actor) => {
      requireDirector(actor);
      const pkg = await store.get(id); const context = await finalizationContext();
      if (!pkg.finalization) checkFinalization(pkg, context, issueDate, actor);
      else if (pkg.snapshotHash !== context.source.hash) throw new DirectorApiError(422, "Sumber paket berubah.");
      return call("finalize", { id, expectedRevision, requestId, issueDate, actor, revisionHash: packageRevisionHash(pkg), snapshotHash: context.source.hash, applicabilityHash: pkg.applicabilityHash, baselineId: context.register.baselineId });
    },
    confirmSigned: async (id, expectedRevision, evidenceRef, signedAt, actor) => {
      requireDirector(actor);
      const context = await finalizationContext();
      if (!(await context.verifyEvidenceRef?.(evidenceRef, await store.get(id), signedAt)) || !Number.isFinite(Date.parse(signedAt)) || Date.parse(signedAt) > Date.now()) throw new DirectorApiError(422, "Bukti pengesahan belum dapat diverifikasi.");
      return call("confirm_signed", { id, expectedRevision, evidenceRef, signedAt, actor });
    },
  };
  return store;
}
