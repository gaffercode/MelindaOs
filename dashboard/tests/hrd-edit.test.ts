import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PUT } from "@/app/api/hrd/directory/route";
import { POST as accountLogin } from "@/app/api/access/session/route";
import { POST as directorLogin } from "@/app/api/director/session/route";
import { HrdValidationError, normalizePhone, parseDirectory, saveHrdDirectory, validateDirectoryEdit } from "@/lib/hrd/hrd-directory";
import { PrivateJsonConflict, savePrivateJson, versionOf } from "@/lib/storage/private-json";
import { ACCESS_FIXTURES, DIRECTOR_FIXTURE_PASSCODE } from "./fixtures/access-accounts";
import { createAccessFakeFetch } from "./helpers/access-fake-store";
import { ACCESS_TEST_ORIGIN, stubAccessEnv } from "./helpers/access-test-env";

// Only the fictional sample is used here; the real directory lives in the private bucket `hrd`.
const sampleText = readFileSync(join(process.cwd(), "data", "synthetic", "hrd-directory.json"), "utf8");
const sample = parseDirectory(JSON.parse(sampleText))!;
const edit = (patch: Partial<typeof sample> = {}) => structuredClone({ officials: sample.officials, staff: sample.staff, ...patch });
const rejects = (input: unknown, message: RegExp) => expect(() => validateDirectoryEdit(input)).toThrow(message);

describe("directory edit validation", () => {
  it("accepts the sample unchanged and trims spacing", () => {
    const input = edit();
    input.staff[0].name = `  ${input.staff[0].name}   `;
    const clean = validateDirectoryEdit(input);
    expect(clean.officials).toHaveLength(sample.officials.length);
    expect(clean.staff[0].name).toBe(sample.staff[0].name);
  });

  it("stores phone numbers as +62 and rejects anything that is not an Indonesian mobile number", () => {
    expect(normalizePhone("0812 3456 7890", "Direktur")).toBe("+6281234567890");
    expect(normalizePhone("62-812-3456-7890", "Direktur")).toBe("+6281234567890");
    expect(normalizePhone("+6281234567890", "Direktur")).toBe("+6281234567890");
    expect(() => normalizePhone("0354 123456", "Direktur")).toThrow(HrdValidationError);
    expect(() => normalizePhone("0812abc", "Direktur")).toThrow(/hanya boleh berisi angka/);
  });

  it("keeps the reporting line a single tree", () => {
    const twoRoots = edit();
    twoRoots.officials[1].parent = null;
    rejects(twoRoots, /tepat satu pejabat puncak/);

    const missing = edit();
    missing.officials[1].parent = "tidak-ada";
    rejects(missing, /tidak ada di daftar pejabat/);

    const self = edit();
    self.officials[1].parent = self.officials[1].id;
    rejects(self, /atasan dirinya sendiri/);

    const loop = edit();
    const [a, b] = loop.officials.filter((o) => o.parent !== null);
    a.parent = b.id;
    b.parent = a.id;
    rejects(loop, /berputar/);
  });

  it("rejects duplicates, unknown units, empty names and oversized lists", () => {
    const twice = edit();
    twice.staff.push({ ...twice.staff[0], name: twice.staff[0].name.toUpperCase() });
    rejects(twice, /tercatat dua kali/);

    const unit = edit();
    unit.staff[0].unit = "Unit Fiktif";
    rejects(unit, /tidak dikenal/);

    const empty = edit();
    empty.officials[0].name = "   ";
    rejects(empty, /wajib diisi/);

    rejects({ officials: [], staff: [] }, /Jumlah pejabat/);
    rejects(edit({ staff: Array.from({ length: 501 }, (_, i) => ({ name: `Contoh ${i}`, title: "", position: null, unit: null })) }), /maksimal 500/);
    rejects("not an object", /Format data SDM/);
  });
});

describe("private document save", () => {
  const actor = { id: "director", displayName: "Direktur" };
  const now = () => new Date("2026-11-20T05:00:00.000Z");

  it("writes the local file, keeps the previous version, and refuses a stale version", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "hrd-save-"));
    const first = await saveHrdDirectory(edit(), { expectedVersion: "0".repeat(64), actor, now, env: {} as NodeJS.ProcessEnv, dataDir });
    const stored = readFileSync(join(dataDir, "hrd", "directory.json"), "utf8");
    expect(first).toEqual({ version: versionOf(stored), updatedAt: "2026-11-20T05:00:00.000Z", updatedBy: "Direktur" });
    expect(parseDirectory(JSON.parse(stored))).toMatchObject({ updatedBy: "Direktur" });

    const changed = edit();
    changed.staff[0].position = "Jabatan Baru";
    await saveHrdDirectory(changed, { expectedVersion: first.version, actor, now, env: {} as NodeJS.ProcessEnv, dataDir });
    expect(readdirSync(join(dataDir, "hrd", "history"))).toEqual(["20261120T050000Z-director-directory.json"]);
    await expect(saveHrdDirectory(changed, { expectedVersion: first.version, actor, now, env: {} as NodeJS.ProcessEnv, dataDir })).rejects.toBeInstanceOf(PrivateJsonConflict);
  });

  it("reads, compares, backs up and upserts in Supabase, in that order", async () => {
    const env = { MELINDAOS_SUPABASE_URL: "https://project.supabase.example/", MELINDAOS_SUPABASE_SECRET_KEY: "test-service-key" } as unknown as NodeJS.ProcessEnv;
    const calls: { url: string; method: string; upsert?: string }[] = [];
    const transport = (async (url: string, init: RequestInit = {}) => {
      const headers = init.headers as Record<string, string>;
      calls.push({ url, method: init.method ?? "GET", upsert: headers["x-upsert"] });
      return init.method === "POST" ? new Response("{}", { status: 200 }) : new Response(sampleText, { status: 200 });
    }) as unknown as typeof fetch;
    await expect(savePrivateJson({}, { object: "directory.json", expectedVersion: "f".repeat(64), actorId: "x", env, transport, now })).rejects.toBeInstanceOf(PrivateJsonConflict);
    expect(calls).toHaveLength(1);

    calls.length = 0;
    await savePrivateJson({ ok: true }, { object: "directory.json", expectedVersion: versionOf(sampleText), actorId: "user/../x", env, transport, now });
    expect(calls).toEqual([
      { url: "https://project.supabase.example/storage/v1/object/hrd/directory.json", method: "GET", upsert: undefined },
      { url: "https://project.supabase.example/storage/v1/object/hrd/history/20261120T050000Z-user_.._x-directory.json", method: "POST", upsert: undefined },
      { url: "https://project.supabase.example/storage/v1/object/hrd/directory.json", method: "POST", upsert: "true" },
    ]);
  });

  it("stops before writing when the backup fails", async () => {
    const env = { MELINDAOS_SUPABASE_URL: "https://project.supabase.example/", MELINDAOS_SUPABASE_SECRET_KEY: "k" } as unknown as NodeJS.ProcessEnv;
    const methods: string[] = [];
    const transport = (async (_url: string, init: RequestInit = {}) => {
      methods.push(init.method ?? "GET");
      return init.method === "POST" ? new Response("no", { status: 500 }) : new Response(sampleText, { status: 200 });
    }) as unknown as typeof fetch;
    await expect(savePrivateJson({}, { object: "directory.json", expectedVersion: versionOf(sampleText), actorId: "x", env, transport, now })).rejects.toThrow(/keep history/);
    expect(methods).toEqual(["GET", "POST"]);
  });
});

describe("PUT /api/hrd/directory", () => {
  const HR = ACCESS_FIXTURES.find((account) => account.role === "STAFF_HR")!;
  const FINANCE = ACCESS_FIXTURES.find((account) => account.role === "STAFF_FINANCE")!;
  const VICE = ACCESS_FIXTURES.find((account) => account.role === "VICE_DIRECTOR")!;
  let bucket: Map<string, string>;

  beforeEach(() => {
    stubAccessEnv();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const fake = createAccessFakeFetch();
    bucket = new Map([["directory.json", sampleText]]);
    vi.stubGlobal("fetch", async (input: string, init: RequestInit = {}) => {
      const url = String(input);
      const object = url.match(/\/storage\/v1\/object\/hrd\/(.+)$/)?.[1];
      if (object === undefined) return fake.fetch(input, init);
      const key = decodeURIComponent(object);
      if ((init.method ?? "GET") === "GET") return bucket.has(key) ? new Response(bucket.get(key), { status: 200 }) : new Response("missing", { status: 404 });
      bucket.set(key, String(init.body));
      return new Response("{}", { status: 200 });
    });
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  const post = (path: string, body: unknown) => new Request(`${ACCESS_TEST_ORIGIN}${path}`, { method: "POST", headers: { Origin: ACCESS_TEST_ORIGIN, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  async function signIn(email?: string, password?: string) {
    const response = email ? await accountLogin(post("/api/access/session", { email, password })) : await directorLogin(post("/api/director/session", { passcode: DIRECTOR_FIXTURE_PASSCODE }));
    expect(response.status).toBe(200);
    const { csrfToken } = await response.json() as { csrfToken: string };
    return { Cookie: response.headers.get("set-cookie")!.split(";")[0], "X-CSRF-Token": csrfToken };
  }
  const put = (body: unknown, headers: Record<string, string>) =>
    PUT(new Request(`${ACCESS_TEST_ORIGIN}/api/hrd/directory`, { method: "PUT", headers: { Origin: ACCESS_TEST_ORIGIN, "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) }));
  const body = (patch: Partial<typeof sample> = {}) => ({ version: versionOf(sampleText), ...edit(patch) });

  it("lets HR staff save, records who saved, and keeps the previous version", async () => {
    const changed = body();
    changed.officials[0].phone = "0812 0000 0099";
    const response = await put(changed, await signIn(HR.email, HR.password));
    expect(response.status).toBe(200);
    const saved = await response.json() as { version: string; updatedBy: string };
    expect(saved.updatedBy).toBe(HR.displayName);
    const stored = JSON.parse(bucket.get("directory.json")!);
    expect(stored.officials[0].phone).toBe("+6281200000099");
    expect(saved.version).toBe(versionOf(bucket.get("directory.json")!));
    expect([...bucket.keys()].filter((key) => key.startsWith("history/"))).toHaveLength(1);
  });

  it("lets the Director save", async () => {
    expect((await put(body(), await signIn())).status).toBe(200);
  });

  it("refuses roles without hrd.edit, a missing CSRF token, and no session", async () => {
    for (const account of [FINANCE, VICE]) expect((await put(body(), await signIn(account.email, account.password))).status).toBe(403);
    const { Cookie } = await signIn(HR.email, HR.password);
    expect((await put(body(), { Cookie })).status).toBe(403);
    expect((await put(body(), {})).status).toBe(401);
    expect(bucket.get("directory.json")).toBe(sampleText);
  });

  it("answers 409 when someone else saved first and 400 with the reason for bad data", async () => {
    const headers = await signIn(HR.email, HR.password);
    const stale = await put({ ...body(), version: "a".repeat(64) }, headers);
    expect(stale.status).toBe(409);
    expect((await stale.json()).error).toMatch(/sudah diubah orang lain/);

    const bad = body();
    bad.officials[0].phone = "12345";
    const invalid = await put(bad, headers);
    expect(invalid.status).toBe(400);
    expect((await invalid.json()).error).toMatch(/bukan nomor HP Indonesia/);

    expect((await put({ ...body(), version: "v1" }, headers)).status).toBe(400);
    expect((await put({ ...body(), extra: true }, headers)).status).toBe(400);
    expect(bucket.get("directory.json")).toBe(sampleText);
  });
});
