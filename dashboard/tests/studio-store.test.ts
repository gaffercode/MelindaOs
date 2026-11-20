import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileStudioStore } from "@/lib/studio/file-store";
import { assemblePackage, packageRevisionHash } from "@/lib/studio/assemble-package";
import { loadRequirementRegister } from "@/lib/starkes/requirements";

const dirs: string[] = [];
const actor = { role: "mutu" as const, reviewerId: "mutu-test" };
async function setup() {
  const dir = await mkdtemp(join(tmpdir(), "studio-store-")); dirs.push(dir);
  const pkg = assemblePackage({ packageKey: "identifikasi-pasien", source: { hash: "s", sources: [], facts: [] }, register: loadRequirementRegister(), applicability: {} });
  const store = new FileStudioStore(dir); await store.create(pkg, actor);
  return { dir, store, pkg };
}
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });
describe("Studio persistence", () => {
  it("persists_revisions_across_reload", async () => {
    const { store, pkg, dir } = await setup(); pkg.documents[0].title = "Revised";
    const saved = await store.save(pkg, 1, actor);
    expect(saved.revision).toBe(2);
    expect((await new FileStudioStore(dir).get(pkg.id)).documents[0].title).toBe("Revised");
    const raw = JSON.parse(await readFile(join(dir, "packages.json"), "utf8"));
    expect(raw.history[pkg.id]).toHaveLength(2);
  });
  it("rejects_stale_expected_revision", async () => {
    const { store, pkg } = await setup(); await store.save(pkg, 1, actor);
    await expect(store.save(pkg, 1, actor)).rejects.toMatchObject({ status: 409 });
    expect((await store.get(pkg.id)).revision).toBe(2);
  });
  it("signed_snapshot_is_immutable", async () => {
    const { store, pkg, dir } = await setup();
    // Seed an already signed persisted revision; public save cannot assign this status.
    const file = join(dir, "packages.json");
    const raw = JSON.parse(await readFile(file, "utf8")); raw.packages[pkg.id].status = "signed";
    const { writeFile } = await import("node:fs/promises"); await writeFile(file, JSON.stringify(raw));
    await expect(store.save(pkg, 1, actor)).rejects.toMatchObject({ status: 409 });
  });
  it("review_tracks_actor_hash_and_time", async () => {
    const { store, pkg } = await setup(); const hash = packageRevisionHash(pkg);
    const reviewed = await store.review(pkg.id, 1, hash, actor);
    expect(reviewed.review).toMatchObject({ hash, reviewerId: "mutu-test" });
    expect(Number.isFinite(Date.parse(reviewed.review!.reviewedAt))).toBe(true);
    const saved = await store.save(reviewed, 2, actor);
    expect(saved.review).toBeNull(); expect(saved.status).toBe("draft");
  });
  it("rejects_client_forged_ready_and_fake_review_hash", async () => {
    const { store, pkg } = await setup();
    await expect(store.review(pkg.id, 1, "fake", actor)).rejects.toMatchObject({ status: 409 });
    const saved = await store.save({ ...pkg, status: "ready_for_signature", finalizedHash: "fake" }, 1, actor);
    expect(saved.status).toBe("draft"); expect(saved.finalizedHash).toBeUndefined();
  });
});
