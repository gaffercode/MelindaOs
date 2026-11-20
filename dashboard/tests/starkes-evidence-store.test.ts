import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { decideBatch, listEvidence, upsertPending, withdrawMissing, type NewEvidence } from "../lib/starkes/evidence-store";

const file = (ref: string, chapter: string, modified: string): NewEvidence => ({
  source: "drive", ref, chapter_code: chapter, kind: "D", ep_ids: [`47104-2024:${chapter}:1:1`], name: `${ref}.pdf`,
  mime: "application/pdf", web_link: `https://drive.google.com/file/d/${ref}`, modified_at: modified, matched_by: "ai", confidence: 0.7, phi_flag: false,
});

describe("evidence store (file mode)", () => {
  beforeEach(async () => {
    process.env.MELINDAOS_DIRECTOR_STORE = "file";
    process.env.MELINDAOS_DIRECTOR_DATA_DIR = await mkdtemp(join(tmpdir(), "starkes-evidence-"));
  });

  it("stores new files as pending and keeps a decision while the file is unchanged", async () => {
    await upsertPending([file("f1", "SKP", "2026-11-01T00:00:00Z")]);
    const [row] = await listEvidence();
    expect(row.status).toBe("pending");
    await decideBatch([row.id], "approved");
    await upsertPending([file("f1", "SKP", "2026-11-01T00:00:00Z")]);
    expect((await listEvidence())[0].status).toBe("approved");
  });

  it("moves a file to its new chapter as one pending row", async () => {
    await upsertPending([file("f1", "SKP", "2026-11-01T00:00:00Z")]);
    await decideBatch([(await listEvidence())[0].id], "approved");
    await upsertPending([file("f1", "PPI", "2026-11-01T00:00:00Z")]);
    const rows = await listEvidence();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ chapter_code: "PPI", status: "pending" });
  });

  it("withdraws Drive files missing from their chapter, never KB rows", async () => {
    await upsertPending([file("f1", "SKP", "2026-11-01T00:00:00Z"), file("f2", "SKP", "2026-11-01T00:00:00Z"), { ...file("kb-1", "SKP", ""), source: "kb" }]);
    expect(await withdrawMissing("SKP", ["f1"])).toBe(1);
    const status = Object.fromEntries((await listEvidence()).map((r) => [r.ref, r.status]));
    expect(status).toEqual({ f1: "pending", f2: "withdrawn", "kb-1": "pending" });
  });
});
