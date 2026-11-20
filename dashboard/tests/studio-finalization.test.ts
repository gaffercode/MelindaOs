import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registeredSignature } from "@/lib/studio/store";
import { FileStudioStore } from "@/lib/studio/file-store";
import { finalizePackage, type NumberSeries } from "@/lib/studio/finalize-package";
import { assemblePackage, packageRevisionHash } from "@/lib/studio/assemble-package";
import { loadRequirementRegister } from "@/lib/starkes/requirements";
import type { SourceSnapshot } from "@/lib/studio/source-snapshot";
import { makeDocument } from "./fixtures/studio-package";

const dirs: string[] = [];
const director = { role: "director" as const, reviewerId: "director-test" };
const mutu = { role: "mutu" as const, reviewerId: "mutu-test" };
const register = loadRequirementRegister();
async function setup(reconciled = true) {
  const dir = await mkdtemp(join(tmpdir(), "studio-final-")); dirs.push(dir);
  const source: SourceSnapshot = { hash: "s", sources: ["org-2026", "identifikasi"].map((id) => ({ ...makeDocument().sources[0], id })), facts: [{ key: "director.name", value: "Test Director", sourceIds: ["org-2026"], status: "verified", usage: "static", effectiveFrom: "2026-01-01", effectiveUntil: null }] };
  const series: NumberSeries[] = ["sk", "spo", "form", "materi", "monitoring"].map((id) => ({ id, format: `{seq}/${id}/{year}`, nextSequence: 1, authority: "director", sourceIds: ["org-2026"], reconciled }));
  const context: import("@/lib/studio/finalize-package").FinalizationContext = { source, register, series, verifyEvidenceRef: async (ref: string) => ref === "/kredensial/signed-policy" };
  const store = new FileStudioStore(dir, async () => context);
  async function create() {
    const pkg = assemblePackage({ packageKey: "identifikasi-pasien", source, register, applicability: Object.fromEntries(register.requirements.map((r) => [r.id, "applicable"])) });
    await store.create(pkg, mutu);
    return store.review(pkg.id, 1, packageRevisionHash(pkg), mutu);
  }
  return { dir, store, context, create, pkg: await create() };
}
afterEach(async () => { vi.unstubAllEnvs(); for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });
describe("Studio finalization", () => {
  it("refuses_unreconciled_number_series", async () => {
    const { store, pkg } = await setup(false);
    await expect(finalizePackage(store, pkg.id, 2, "request-1", "2026-11-05", director)).rejects.toThrow("penomoran");
    expect((await store.get(pkg.id)).status).toBe("in_review");
  });
  it("same_request_returns_same_numbers", async () => {
    const { store, pkg } = await setup();
    const first = await store.finalize(pkg.id, 2, "request-1", "2026-11-05", director);
    const repeated = await store.finalize(pkg.id, 2, "request-1", "2026-11-05", director);
    expect(repeated).toEqual(first); expect(first.documents[0].number).toBe("001/sk/2026");
    expect(first.status).toBe("ready_for_signature"); expect(first.signature).toBeUndefined();
  });
  it("concurrent_packages_get_unique_numbers", async () => {
    const { store, pkg, create } = await setup(); const other = await create();
    const both = await Promise.all([store.finalize(pkg.id, 2, "one", "2026-11-05", director), store.finalize(other.id, 2, "two", "2026-11-05", director)]);
    expect(new Set(both.flatMap((p) => p.documents.map((d) => d.number))).size).toBe(10);
  });
  it("mutu_cannot_finalize", async () => {
    const { store, pkg } = await setup();
    await expect(store.finalize(pkg.id, 2, "one", "2026-11-05", mutu)).rejects.toMatchObject({ status: 403 });
  });
  it("changed_source_or_applicability_blocks_finalize", async () => {
    const { store, pkg, context } = await setup(); context.source.hash = "changed";
    await expect(store.finalize(pkg.id, 2, "one", "2026-11-05", director)).rejects.toMatchObject({ status: 422 });
  });
  it("director_cannot_sign_owner_document", async () => {
    const { store, pkg } = await setup(); pkg.documents[0].authority = "owner";
    const saved = await store.save(pkg, 2, mutu); await store.review(pkg.id, 3, packageRevisionHash(saved), mutu);
    await expect(store.finalize(pkg.id, 4, "one", "2026-11-05", director)).rejects.toMatchObject({ status: 422 });
  });
  it("signature_confirmation_needs_evidence", async () => {
    const { store, pkg } = await setup(); const final = await store.finalize(pkg.id, 2, "one", "2026-11-05", director);
    await expect(store.confirmSigned(pkg.id, final.revision, "", "2026-11-05T00:00:00Z", director)).rejects.toMatchObject({ status: 422 });
  });
  it("records_only_registered_evidence_for_the_exact_final_package", async () => {
    const { store, pkg, context } = await setup();
    context.verifyEvidenceRef = registeredSignature;
    const signedAt = "2026-11-05";
    const evidenceRef = "ARSIP-SIGNED-TEST";
    const final = await store.finalize(pkg.id, 2, "one", signedAt, director);
    const record = { packageId: pkg.id, evidenceRef, signedAt, finalizedHash: final.finalizedHash };
    vi.stubEnv("MELINDAOS_STUDIO_SIGNATURE_REGISTER", JSON.stringify([{ ...record, finalizedHash: "other-version" }]));
    await expect(store.confirmSigned(pkg.id, final.revision, evidenceRef, signedAt, director)).rejects.toMatchObject({ status: 422 });
    vi.stubEnv("MELINDAOS_STUDIO_SIGNATURE_REGISTER", JSON.stringify([record]));
    await expect(store.confirmSigned(pkg.id, final.revision, evidenceRef, signedAt, mutu)).rejects.toMatchObject({ status: 403 });
    await expect(store.confirmSigned(pkg.id, final.revision, evidenceRef, signedAt, director)).resolves.toMatchObject({
      status: "signed", finalizedHash: final.finalizedHash, signature: { evidenceRef, signedAt, confirmedBy: director.reviewerId },
    });
  });
  it("repeated_signature_does_not_create_event", async () => {
    const { store, pkg, dir } = await setup(); const final = await store.finalize(pkg.id, 2, "one", "2026-11-05", director);
    const signed = await store.confirmSigned(pkg.id, final.revision, "/kredensial/signed-policy", "2026-11-05T00:00:00Z", director);
    const again = await store.confirmSigned(pkg.id, final.revision, "/kredensial/signed-policy", "2026-11-05T00:00:00Z", director);
    expect(again).toEqual(signed);
    const raw = JSON.parse(await readFile(join(dir, "packages.json"), "utf8"));
    expect(raw.events.filter((e: { command: string }) => e.command === "confirm_signed")).toHaveLength(1);
  });
});
