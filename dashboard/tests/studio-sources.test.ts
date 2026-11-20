import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildStudioSourceSnapshot, loadStudioSourceSnapshot } from "@/lib/studio/source-snapshot";

const roots: string[] = [];
async function fixture(body = "# Institution\n\n## Identity\nDirector: Alice\n") {
  const root = await mkdtemp(join(tmpdir(), "studio-source-")); roots.push(root);
  await mkdir(join(root, "dashboard/data/studio"), { recursive: true });
  await mkdir(join(root, "knowledge/01_HOSPITAL"), { recursive: true });
  await writeFile(join(root, "knowledge/01_HOSPITAL/profile.md"), body);
  await writeFile(join(root, "dashboard/data/studio/sources.json"), JSON.stringify([
    { id: "profile", path: "knowledge/01_HOSPITAL/profile.md", locator: "Identity", reviewedAt: "2026-11-05", status: "verified" },
  ]));
  await writeFile(join(root, "dashboard/data/studio/facts.json"), JSON.stringify([
    { key: "director", value: "Alice", sourceIds: ["profile"], status: "verified", effectiveFrom: null, effectiveUntil: null, usage: "static" },
  ]));
  return root;
}
afterEach(async () => { vi.unstubAllEnvs(); for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

describe("Studio source snapshots", () => {
  it("approved_header_does_not_override_draft_body", async () => {
    const root = await fixture("---\ngovernance: APPROVED\n---\n## Identity\nDRAF UNTUK KOREKSI\nDirector: Alice\n");
    const snapshot = await buildStudioSourceSnapshot(root, "2026-11-05");
    expect(snapshot.facts[0].status).toBe("missing");
    expect(snapshot.sources[0].status).toBe("unresolved");
  });
  it("conflicting_names_remain_conflict", async () => {
    const root = await fixture();
    await writeFile(join(root, "dashboard/data/studio/facts.json"), JSON.stringify([
      { key: "director", value: "Alice", sourceIds: ["profile"], status: "verified", usage: "static" },
      { key: "director", value: "Bob", sourceIds: ["profile"], status: "verified", usage: "static" },
    ]));
    expect((await buildStudioSourceSnapshot(root, "2026-11-05")).facts.every((f) => f.status === "conflict")).toBe(true);
  });
  it("expired_contract_cannot_be_current", async () => {
    const root = await fixture();
    await writeFile(join(root, "dashboard/data/studio/facts.json"), JSON.stringify([
      { key: "contract", value: "Alice", sourceIds: ["profile"], status: "verified", effectiveUntil: "2026-01-01", usage: "requires_current_evidence" },
    ]));
    expect((await buildStudioSourceSnapshot(root, "2026-11-05")).facts[0].status).toBe("missing");
  });
  it("rejects_parent_and_symlink_escape", async () => {
    const root = await fixture();
    await writeFile(join(root, "dashboard/data/studio/sources.json"), JSON.stringify([{ id: "escape", path: "../outside.md", locator: "Identity", status: "verified", reviewedAt: "2026-11-05" }]));
    await expect(buildStudioSourceSnapshot(root, "2026-11-05")).rejects.toThrow("Sumber di luar cakupan");
    const outside = await mkdtemp(join(tmpdir(), "studio-outside-")); roots.push(outside);
    await writeFile(join(outside, "profile.md"), "# Identity\nAlice");
    await symlink(outside, join(root, "knowledge/01_HOSPITAL/external"), "junction");
    await writeFile(join(root, "dashboard/data/studio/sources.json"), JSON.stringify([{ id: "escape", path: "knowledge/01_HOSPITAL/external/profile.md", locator: "Identity", status: "verified", reviewedAt: "2026-11-05" }]));
    await expect(buildStudioSourceSnapshot(root, "2026-11-05")).rejects.toThrow("Sumber di luar cakupan");
  });
  it("hosted_snapshot_works_without_repo", async () => {
    const root = await fixture(); const snapshot = await buildStudioSourceSnapshot(root, "2026-11-05");
    const file = join(root, "snapshot.json"); await writeFile(file, JSON.stringify(snapshot));
    vi.stubEnv("MELINDAOS_STUDIO_SNAPSHOT", file);
    expect(await loadStudioSourceSnapshot()).toEqual(snapshot);
    expect(snapshot.facts[0].status).toBe("verified");
    expect(snapshot.hash).toMatch(/^[a-f0-9]{64}$/);
  });
});
