import { DirectorApiError } from "../director/director-api";
import type { RequirementRegister } from "../starkes/requirements";
import { evaluatePackage, packageRevisionHash } from "./assemble-package";
import type { StudioPackage } from "./contracts";
import { validDocumentDate } from "./rules";
import type { SourceSnapshot } from "./source-snapshot";
import type { StudioActor, StudioStore } from "./store";

export type NumberSeries = { id: string; format: string; nextSequence: number | null; authority: "director" | "owner"; sourceIds: string[]; reconciled: boolean };
export type FinalizationContext = { source: SourceSnapshot; register: RequirementRegister; series: NumberSeries[]; verifyEvidenceRef?: (ref: string, pkg: StudioPackage, signedAt: string) => boolean | Promise<boolean> };
export function requireDirector(actor: StudioActor): void {
  if (actor.role !== "director") throw new DirectorApiError(403, "Hanya Direktur yang dapat memfinalisasi dokumen.");
}

/** Validate reviewed content using prospective publication fields, before allocating numbers. */
export function checkFinalization(pkg: StudioPackage, context: FinalizationContext, issueDate: string, actor: StudioActor): void {
  requireDirector(actor);
  if (!validDocumentDate(issueDate)) throw new DirectorApiError(422, "Tanggal penetapan tidak valid.");
  if (!pkg.review || pkg.review.hash !== packageRevisionHash(pkg)) throw new DirectorApiError(422, "Review substansi belum sesuai revisi.");
  if (context.source.facts.some((f) => pkg.requiredFactKeys.includes(f.key) && f.effectiveFrom !== null && f.effectiveFrom > issueDate)) throw new DirectorApiError(422, "Tanggal penetapan mendahului sumber yang berlaku.");
  const prospective = structuredClone(pkg);
  prospective.documents.forEach((d) => { d.number = "PENDING-ALLOCATION"; d.issueDate = issueDate; });
  // Publication metadata is assigned by the Director, after the content review.
  prospective.review = null;
  const blockers = evaluatePackage(prospective, context.source, context.register).filter((i) => i.severity === "blocker");
  if (blockers.length) throw new DirectorApiError(422, blockers.map((i) => i.message).join(" "));
}

export function finalizePackage(store: StudioStore, id: string, expectedRevision: number, requestId: string, issueDate: string, actor: StudioActor): Promise<StudioPackage> {
  return store.finalize(id, expectedRevision, requestId, issueDate, actor);
}

export function formatDocumentNumber(series: NumberSeries, issueDate: string): string {
  if (!series.reconciled || !series.nextSequence || !Number.isSafeInteger(series.nextSequence) || series.nextSequence < 1 || !series.sourceIds.length || !series.format.includes("{seq}")) throw new DirectorApiError(422, "Register penomoran belum direkonsiliasi.");
  const month = Number(issueDate.slice(5, 7));
  const roman = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"][month - 1];
  const result = series.format.replaceAll("{seq}", String(series.nextSequence).padStart(3, "0")).replaceAll("{year}", issueDate.slice(0, 4)).replaceAll("{month}", roman);
  if (/[{}]/.test(result)) throw new DirectorApiError(422, "Format penomoran tidak valid.");
  return result;
}
