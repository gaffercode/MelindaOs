import { scryptSync } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requireConfiguration } from "@/lib/director/director-api";
import { clearDailyDocumentCache, readDailyDocument, submitDailyDocument } from "@/lib/daily/daily-documents";

/**
 * Inside the Next.js runtime the daily-document store reads go through `unstable_cache` (shared Data Cache on
 * Vercel) tagged per kind, and a publish expires that tag immediately (`{ expire: 0 }`), so the next read
 * does not keep the previous document. `"max"` would serve it stale for up to a year.
 * Outside Next (tests, scripts) the per-process cache stays in charge. `next/cache` itself is mocked here: it
 * refuses to run without a Next request context, and this test pins the wiring, not Next's internals.
 */
const cacheCalls: { keyParts: string[] | undefined; options: unknown }[] = [];
const revalidated: [string, string | { expire?: number }][] = [];
vi.mock("next/cache", () => ({
  unstable_cache: (callback: () => unknown, keyParts?: string[], options?: unknown) => { cacheCalls.push({ keyParts, options }); return callback; },
  revalidateTag: (tag: string, profile: string | { expire?: number }) => { revalidated.push([tag, profile]); },
  revalidatePath: () => undefined,
}));

const salt = "00112233445566778899aabbccddeeff";
const passcodeHash = `scrypt$${salt}$${scryptSync("synthetic-test-passcode", salt, 64).toString("hex")}`;
let reads: number;

beforeEach(() => {
  cacheCalls.length = 0; revalidated.length = 0; reads = 0;
  vi.stubEnv("MELINDAOS_DIRECTOR_STORE", "supabase");
  vi.stubEnv("MELINDAOS_APP_ORIGIN", "https://synthetic.example");
  vi.stubEnv("MELINDAOS_SUPABASE_URL", "https://synthetic.supabase.co");
  vi.stubEnv("MELINDAOS_SUPABASE_SECRET_KEY", "sb_secret_synthetic");
  vi.stubEnv("MELINDAOS_REVIEWER_PASSCODE_HASH", passcodeHash);
  vi.stubEnv("MELINDAOS_REVIEWER_ID", "director-test");
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
    const { command } = JSON.parse(init.body as string) as { command: string };
    if (command === "read") { reads += 1; return Response.json({ document: null }); }
    if (command === "submit") return Response.json({ replayed: false, id: "00000000-0000-4000-8000-000000000001", kind: "management_brief", date: "2026-10-23", payloadHash: "0".repeat(64), receivedAt: "2026-10-23T01:00:00.000Z" });
    return Response.json({ errorCode: "invalid_command" });
  });
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); clearDailyDocumentCache(); });

describe("daily documents in the Next.js runtime", () => {
  it("reads the store through unstable_cache tagged per kind with a 60-second lifetime", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    const result = await readDailyDocument("management_brief", "2026-10-23");
    expect(result).toEqual({ document: null, source: "supabase" });
    expect(reads).toBe(1);
    expect(cacheCalls).toEqual([{ keyParts: ["management_brief", "2026-10-23", "6"], options: { tags: ["daily-document:management_brief"], revalidate: 60 } }]);
  });

  it("revalidates the kind's tag when a document is published", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    const receipt = await submitDailyDocument(requireConfiguration(), "management_brief", { producerId: "grokbot", key: "key-synthetic-0001", date: "2026-10-23", payload: { a: 1 } });
    expect(receipt.replayed).toBe(false);
    expect(revalidated).toEqual([["daily-document:management_brief", { expire: 0 }]]);
  });

  it("keeps the per-process cache outside the Next.js runtime", async () => {
    await readDailyDocument("management_brief", "2026-10-23");
    await readDailyDocument("management_brief", "2026-10-23");
    expect(reads).toBe(1);
    expect(cacheCalls).toEqual([]);
    await submitDailyDocument(requireConfiguration(), "management_brief", { producerId: "grokbot", key: "key-synthetic-0002", date: "2026-10-23", payload: { a: 1 } });
    expect(revalidated).toEqual([]);
  });
});
