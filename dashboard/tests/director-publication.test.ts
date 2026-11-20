import { scryptSync } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readDirectorDay } from "@/lib/director/director-repository";
import { canonicalHash } from "@/lib/director/director-store";
import type { Revision } from "@/lib/director/director-api";
import type { DirectorSubmission } from "@/lib/director/director-submission";
import template from "@/data/director/templates/day-v2.json";

beforeEach(() => {
  const salt = "00112233445566778899aabbccddeeff";
  vi.stubEnv("MELINDAOS_DIRECTOR_STORE", "supabase");
  vi.stubEnv("MELINDAOS_APP_ORIGIN", "https://synthetic.example");
  vi.stubEnv("MELINDAOS_SUPABASE_URL", "https://synthetic.supabase.co");
  vi.stubEnv("MELINDAOS_SUPABASE_SECRET_KEY", "sb_secret_synthetic");
  vi.stubEnv("MELINDAOS_REVIEWER_PASSCODE_HASH", `scrypt$${salt}$${scryptSync("synthetic-test-passcode", salt, 64).toString("hex")}`);
  vi.stubEnv("MELINDAOS_REVIEWER_ID", "director-test");
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
function revision(id: string, status: Revision["status"], receivedAt: string, title: string): Revision {
  const payload: DirectorSubmission = {
    brief: { ...structuredClone(template.brief), schemaVersion: 2, priorities: { updatedAt: "2026-10-03T08:00:00+07:00", source: "Sumber sintetis", items: [{ id: "p1", title, note: "Bukan laporan rumah sakit", urgent: true }] } },
    provenance: { priorities: { sourceObservedAt: "2026-10-03T08:00:00+07:00", periodStart: "2026-10-03", periodEnd: "2026-10-03", cutoff: null, source: { label: "Sumber sintetis", reference: "urn:test:priorities" }, metricDefinitions: {} } },
  };
  return { id, producer: "grokbot", report_date: "2026-10-03", status, received_at: receivedAt, payload, payload_hash: canonicalHash(payload) };
}
function store(pending: Revision[], published: Revision | null = null) {
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
    const { command, args } = JSON.parse(init.body as string) as { command: string; args: Record<string, unknown> };
    expect(init.cache).toBe("no-store");
    if (command === "published") return Response.json({ published });
    if (command === "review_list") {
      expect(args.date).toBe("2026-10-03");
      expect(typeof args.offset).toBe("number");
      return Response.json({ pending: pending.slice(Number(args.offset), Number(args.offset) + 50), publishedRevisionId: published?.id ?? null, published: published?.payload ?? null });
    }
    if (command === "revision_read" && args.id === published?.id) return Response.json({ revision: published });
    throw new Error("Unexpected database command; reader must not submit or approve reports");
  }));
}
describe("immediately visible director reports", () => {
  it("never falls back to the example JSON when no report has arrived", async () => {
    store([]);
    const result = await readDirectorDay("2026-10-03");
    expect(result.status).toBe("missing");
    expect(result.data.brief).toBeUndefined();
    expect(result.message).toContain("belum diterima");
  });
  it("reads the exact immutable publication and preserves provenance", async () => {
    const published = revision("synthetic-revision", "published", "2026-10-03T10:30:00+07:00", "Laporan sudah diperiksa");
    store([], published);
    const result = await readDirectorDay("2026-10-03");
    expect(result.status).toBe("available");
    expect(result.data.schemaVersion).toBe(2);
    expect(result.provenance?.priorities?.source.label).toBe("Sumber sintetis");
    expect(result.publication?.revisionId).toBe("synthetic-revision");
  });
  it("shows the first received report without requiring approval or changing its review state", async () => {
    store([revision("incoming", "pending", "2026-10-03T10:30:00+07:00", "Prioritas dari laporan")]);
    const result = await readDirectorDay("2026-10-03");
    expect(result.status).toBe("available");
    expect(result.data.priorities.items[0].title).toBe("Prioritas dari laporan");
    expect(result.publication).toBeUndefined();
    expect(result.submission).toMatchObject({ revisionId: "incoming", reviewStatus: "pending", receivedAt: "2026-10-03T10:30:00+07:00" });
  });
  it("shows a newer correction immediately rather than an older reviewed snapshot", async () => {
    store([revision("correction", "pending", "2026-10-03T11:00:00+07:00", "Koreksi terbaru")], revision("reviewed", "published", "2026-10-03T10:00:00+07:00", "Laporan lama"));
    const result = await readDirectorDay("2026-10-03");
    expect(result.data.priorities.items[0].title).toBe("Koreksi terbaru");
    expect(result.publication).toBeUndefined();
  });
  it("does not let an older unreviewed snapshot replace a more recently received reviewed report", async () => {
    store([revision("old", "pending", "2026-10-03T09:00:00+07:00", "Kiriman lama")], revision("reviewed", "published", "2026-10-03T10:00:00+07:00", "Kiriman terbaru"));
    expect((await readDirectorDay("2026-10-03")).data.priorities.items[0].title).toBe("Kiriman terbaru");
  });
  it("selects latest receipt deterministically even when the returned queue is unsorted", async () => {
    store([revision("a", "pending", "2026-10-03T10:00:00+07:00", "Pertama"), revision("z", "pending", "2026-10-03T10:00:00+07:00", "Terakhir")]);
    expect((await readDirectorDay("2026-10-03")).data.priorities.items[0].title).toBe("Terakhir");
  });
  it("withholds mismatched hashes, rejected reports and wrong-date snapshots", async () => {
    for (const change of [{ payload_hash: "wrong" }, { status: "rejected" as const }, { status: "superseded" as const }, { report_date: "2026-10-02" }, { received_at: "invalid" }]) {
      store([{ ...revision("incoming", "pending", "2026-10-03T10:30:00+07:00", "Tidak aman"), ...change }]);
      const result = await readDirectorDay("2026-10-03");
      expect(result.status).toBe("invalid");
      expect(result.data.dailyReport.visits).toBeNull();
    }
  });
  it("keeps the previous valid report readable with a warning when the newest hash is corrupt", async () => {
    store([{ ...revision("bad", "pending", "2026-10-03T11:00:00+07:00", "Rusak"), payload_hash: "wrong" }], revision("good", "published", "2026-10-03T10:00:00+07:00", "Versi valid sebelumnya"));
    const result = await readDirectorDay("2026-10-03");
    expect(result.status).toBe("available");
    expect(result.data.priorities.items[0].title).toBe("Versi valid sebelumnya");
    expect(result.message).toContain("belum lolos validasi");
  });
  it("still validates source observations before displaying an unreviewed report", async () => {
    const incoming = revision("future", "pending", "2026-10-03T10:30:00+07:00", "Waktu sumber salah");
    incoming.payload.provenance.priorities!.sourceObservedAt = "2099-10-03T08:00:00+07:00";
    incoming.payload_hash = canonicalHash(incoming.payload);
    store([incoming]);
    expect((await readDirectorDay("2026-10-03")).status).toBe("invalid");
  });
  it("reports a storage outage explicitly rather than treating it as an empty queue", async () => {
    vi.stubGlobal("fetch", async () => Response.json({ error: "unavailable" }, { status: 503 }));
    const result = await readDirectorDay("2026-10-03");
    expect(result.status).toBe("invalid");
    expect(result.data.brief).toBeUndefined();
    expect(result.message).toContain("belum dapat dibaca");
  });
  it("finds the latest valid pending report beyond 50 invalid newer receipts before falling back to publication", async () => {
    const invalid = Array.from({ length: 50 }, (_, index) => ({ ...revision(`bad-${index}`, "pending", "2026-10-03T11:00:00+07:00", "Rusak"), payload_hash: "wrong" }));
    const valid = revision("valid-page-two", "pending", "2026-10-03T10:30:00+07:00", "Kiriman valid halaman kedua");
    for (const published of [null, revision("old-publication", "published", "2026-10-03T09:00:00+07:00", "Versi lama")]) {
      store([...invalid, valid], published);
      const result = await readDirectorDay("2026-10-03");
      expect(result.status).toBe("available");
      expect(result.submission?.revisionId).toBe(valid.id);
      expect(result.publication).toBeUndefined();
      expect(result.message).toContain("belum lolos validasi");
      expect(vi.mocked(fetch).mock.calls.some(([, init]) => JSON.parse(init!.body as string).args.offset === 50)).toBe(true);
    }
  });
});
