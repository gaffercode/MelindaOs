import { scryptSync } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DELETE as clearRoute, GET as listRoute, POST as saveRoute } from "@/app/api/director/document-answers/route";
import { GET as downloadRoute } from "@/app/api/director/document-answers/unduh/route";
import { POST as login } from "@/app/api/director/session/route";
import { csrfForSession, hashSecret } from "@/lib/director/director-auth";
import { wibDate } from "@/lib/director/director-data";
import type { DirectorQueue, StoredAnswer } from "@/lib/knowledge/document-answer-rules";

const queueFile = vi.hoisted((): { queue: DirectorQueue | null } => ({ queue: null }));
vi.mock("@/lib/director/director-queue", () => ({ loadDirectorQueue: async () => queueFile.queue }));

const origin = "https://synthetic.example";
const salt = "00112233445566778899aabbccddeeff";
const passcodeHash = `scrypt$${salt}$${scryptSync("synthetic-test-passcode", salt, 64).toString("hex")}`;
const path = "/api/director/document-answers";
const downloadPath = `${path}/unduh`;
const ID_A = "00000000000000aa";
const ID_B = "00000000000000bb";
const DOC = "knowledge/01_HOSPITAL/x/kb-operasional-x.md";
const LINE_A = "| Nomor | [ISI nomor] | Jam buka [ISI jam] |";
const LINE_B = "| Unit pemilik | Farmasi [CEK] |";
const QUEUE: DirectorQueue = {
  valueRules: { maxLength: 200, refusePattern: "\\b(belum|menunggu)\\b" },
  items: [
    { id: ID_A, docPath: DOC, docTitle: "Dokumen X", heading: "Jadwal", text: LINE_A, slots: [
      { column: 10, placeholder: "[ISI nomor]", kind: "ISI", detail: "Nomor dokumen", lock: "number", header: null },
      { column: 33, placeholder: "[ISI jam]", kind: "ISI", detail: "Perlu data RS", lock: null, header: null },
    ] },
    { id: ID_B, docPath: DOC, docTitle: "Dokumen X", heading: "Jadwal", text: LINE_B, slots: [
      { column: 24, placeholder: "[CEK]", kind: "CEK", detail: null, lock: null, header: null },
    ] },
  ],
  drafts: [],
};
const AT = "2026-11-12T03:00:00+00:00";
const ROW_A: StoredAnswer = { id: ID_A, docPath: DOC, lineText: LINE_A, answeredBy: "director-test", answeredAt: AT, slots: [
  { column: 10, placeholder: "[ISI nomor]", decision: "skip", text: "" },
  { column: 33, placeholder: "[ISI jam]", decision: "value", text: "07.00" },
] };
const ROW_B: StoredAnswer = { id: ID_B, docPath: DOC, lineText: LINE_B, answeredBy: "director-test", answeredAt: AT, slots: [
  { column: 24, placeholder: "[CEK]", decision: "correction", text: "Seharusnya Logistik" },
] };
const VICE = { userId: "00000000-0000-4000-8000-000000000001", email: "vicedirector@melinda.test", role: "VICE_DIRECTOR", displayName: "Wakil Direktur Uji", credentialVersion: "c".repeat(32), mustChange: false };
const VICE_TOKEN = "d".repeat(64);

type Call = { command: string; args: Record<string, unknown> };
let calls: Call[];
let urls: string[];
let rateAllowed: boolean;
let session: { reviewerId: string } | null;
let store: (call: Call) => Response;

beforeEach(() => {
  calls = []; urls = []; rateAllowed = true; session = null; queueFile.queue = QUEUE;
  store = () => Response.json({ errorCode: "invalid_command" });
  vi.stubEnv("MELINDAOS_DIRECTOR_STORE", "supabase");
  vi.stubEnv("MELINDAOS_APP_ORIGIN", origin);
  vi.stubEnv("MELINDAOS_SUPABASE_URL", "https://synthetic.supabase.co");
  vi.stubEnv("MELINDAOS_SUPABASE_SECRET_KEY", "sb_secret_synthetic");
  vi.stubEnv("MELINDAOS_REVIEWER_PASSCODE_HASH", passcodeHash);
  vi.stubEnv("MELINDAOS_REVIEWER_ID", "director-test");
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    const call = JSON.parse(init.body as string) as Call;
    calls.push(call); urls.push(String(url));
    if (String(url).endsWith("/rpc/melinda_access")) return Response.json({ session: call.command === "session_read" && call.args.tokenHash === hashSecret(VICE_TOKEN) ? VICE : null });
    if (call.command === "rate_limit") return Response.json({ allowed: rateAllowed });
    if (call.command === "rate_reset") return Response.json({ ok: true });
    if (call.command === "session_create") { session = { reviewerId: "director-test" }; return Response.json({ ok: true }); }
    if (call.command === "session_read") return Response.json({ session });
    return store(call);
  });
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const sent = (command: string) => calls.filter((call) => call.command === command);
const writes = () => calls.filter((call) => call.command === "set" || call.command === "clear");
const answerLimits = () => sent("rate_limit").filter((call) => String(call.args.bucket).startsWith("director-answers:"));
function request(target: string, method: string, body?: unknown, headers: Record<string, string> = {}) {
  return new Request(`${origin}${target}`, { method, headers: { "Content-Type": "application/json", Origin: origin, ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
async function humanSession() {
  const response = await login(request("/api/director/session", "POST", { passcode: "synthetic-test-passcode" }));
  expect(response.status).toBe(200);
  const body = await response.json() as { csrfToken: string };
  return { Cookie: response.headers.get("set-cookie")!.split(";")[0], "X-CSRF-Token": body.csrfToken };
}
const viceSession = () => ({ Cookie: `melinda_user=${VICE_TOKEN}`, "X-CSRF-Token": csrfForSession(VICE_TOKEN, VICE.credentialVersion) });
async function save(body: unknown, headers?: Record<string, string>) {
  return saveRoute(request(path, "POST", body, headers ?? await humanSession()));
}
async function clear(query: string, headers?: Record<string, string>) {
  return clearRoute(request(`${path}${query}`, "DELETE", undefined, headers ?? await humanSession()));
}
async function refusal(response: Response, status: number, message: string) {
  expect(response.status).toBe(status);
  expect(await response.json()).toEqual({ error: message });
}
const stored = (answers: unknown) => { store = (call) => call.command === "list" ? Response.json({ answers }) : Response.json({ errorCode: "invalid_command" }); };
const saving = (answer: unknown = { saved: 1 }) => { store = (call) => call.command === "set" ? Response.json(answer) : Response.json({ errorCode: "invalid_command" }); };
const clearing = (answer: unknown) => { store = (call) => call.command === "clear" ? Response.json(answer) : Response.json({ errorCode: "invalid_command" }); };
const skip = { decision: "skip" };
const goodA = { id: ID_A, slots: [skip, { decision: "value", text: "07.00" }] };
const handlers: [string, (headers: Record<string, string>) => Promise<Response>][] = [
  ["GET", (headers) => listRoute(request(path, "GET", undefined, headers))],
  ["POST", (headers) => saveRoute(request(path, "POST", goodA, headers))],
  ["DELETE", (headers) => clearRoute(request(`${path}?id=${ID_A}`, "DELETE", undefined, headers))],
  ["GET unduh", (headers) => downloadRoute(request(downloadPath, "GET", undefined, headers))],
];

describe("director answers: who may call", () => {
  it.each(handlers)("%s refuses a caller without a session", async (_name, call) => {
    await refusal(await call({}), 401, "Silakan masuk.");
    expect(sent("list")).toEqual([]);
    expect(writes()).toEqual([]);
    expect(answerLimits()).toEqual([]);
  });

  it.each(handlers)("%s refuses a signed-in Vice Director", async (_name, call) => {
    expect((await call(viceSession())).status).toBe(403);
    expect(sent("list")).toEqual([]);
    expect(writes()).toEqual([]);
  });

  it("refuses a save or a clear without the CSRF token", async () => {
    const { Cookie } = await humanSession();
    expect((await save(goodA, { Cookie })).status).toBe(403);
    expect((await clear(`?id=${ID_A}`, { Cookie })).status).toBe(403);
    expect(writes()).toEqual([]);
  });

  it("refuses a save or a clear from a foreign origin", async () => {
    const headers = { ...await humanSession(), Origin: "https://evil.example" };
    expect((await save(goodA, headers)).status).toBe(403);
    expect((await clear(`?id=${ID_A}`, headers)).status).toBe(403);
    expect(writes()).toEqual([]);
  });

  it.each(handlers)("%s answers 503 when the queue file is not bundled", async (_name, call) => {
    const headers = await humanSession();
    queueFile.queue = null;
    await refusal(await call(headers), 503, "Daftar isian belum tersedia.");
    expect(sent("list")).toEqual([]);
    expect(writes()).toEqual([]);
  });
});

describe("director answers: save", () => {
  it("sends set with the reviewer from the session and the line from the queue file", async () => {
    saving();
    const response = await save(goodA);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ saved: 1 });
    expect(sent("set")).toEqual([{ command: "set", args: { reviewer: "director-test", item: { id: ID_A, docPath: DOC, lineText: LINE_A, slots: [
      { column: 10, placeholder: "[ISI nomor]", decision: "skip", text: "" },
      { column: 33, placeholder: "[ISI jam]", decision: "value", text: "07.00" },
    ] } } }]);
    expect(urls[calls.findIndex((call) => call.command === "set")]).toMatch(/\/rpc\/melinda_director_answers$/);
  });

  it.each([
    ["a docPath in the body", { ...goodA, docPath: "knowledge/01_HOSPITAL/lain.md" }],
    ["a lineText in the body", { ...goodA, lineText: "| lain |" }],
    ["a reviewer in the body", { ...goodA, reviewer: "orang-lain" }],
    ["a column in a slot", { id: ID_A, slots: [skip, { decision: "value", text: "07.00", column: 99 }] }],
    ["a placeholder in a slot", { id: ID_A, slots: [skip, { decision: "value", text: "07.00", placeholder: "[CEK]" }] }],
    ["no id", { slots: goodA.slots }],
    ["no slots", { id: ID_A }],
    ["slots that are not a list", { id: ID_A, slots: { decision: "skip" } }],
    ["a slot that is not an object", { id: ID_A, slots: [skip, "07.00"] }],
    ["a slot without a decision", { id: ID_A, slots: [skip, { text: "07.00" }] }],
    ["an unknown decision", { id: ID_A, slots: [skip, { decision: "delete", text: "07.00" }] }],
    ["a decision that is not text", { id: ID_A, slots: [skip, { decision: 1, text: "07.00" }] }],
    ["a text that is not text", { id: ID_A, slots: [skip, { decision: "value", text: 7 }] }],
    ["a body that is a list", [goodA]],
    ["a body that is null", null],
  ])("rejects %s with the format message", async (_name, body) => {
    await refusal(await save(body), 400, "Format permintaan tidak valid.");
    expect(sent("set")).toEqual([]);
  });

  it.each([
    ["an id the queue does not hold", "00000000000000cc"],
    ["an id that is not text", 7],
    ["an id that is null", null],
  ])("rejects %s", async (_name, id) => {
    await refusal(await save({ id, slots: goodA.slots }), 400, "Baris dokumen tidak dikenal.");
    expect(sent("set")).toEqual([]);
  });

  it.each([
    ["Jumlah isian tidak sesuai baris.", { id: ID_A, slots: [{ decision: "value", text: "07.00" }] }],
    ["Butir ini terkunci.", { id: ID_A, slots: [{ decision: "value", text: "001/SK" }, skip] }],
    ["Pilihan tidak berlaku untuk butir ini.", { id: ID_B, slots: [{ decision: "value", text: "Logistik" }] }],
    ["Isian tidak valid.", { id: ID_A, slots: [skip, { decision: "value", text: "07.00 | 21.00" }] }],
    ["Isi dengan nilainya, bukan keterangan.", { id: ID_A, slots: [skip, { decision: "value", text: "Belum ada" }] }],
    ["Catatan koreksi tidak valid.", { id: ID_B, slots: [{ decision: "correction", text: "a".repeat(281) }] }],
    ["Isian tidak valid.", { id: ID_B, slots: [{ decision: "confirm", text: "ya" }] }],
    ["Belum ada yang diisi.", { id: ID_A, slots: [skip, skip] }],
  ])("answers 400 with \"%s\"", async (message, body) => {
    await refusal(await save(body), 400, message);
    expect(sent("set")).toEqual([]);
  });

  it("trims the text before checking and storing, and treats a missing text as empty", async () => {
    saving();
    expect((await save({ id: ID_A, slots: [{ decision: "skip", text: "  " }, { decision: "value", text: "  07.00\n" }] })).status).toBe(200);
    expect((await save({ id: ID_B, slots: [{ decision: "confirm" }] })).status).toBe(200);
    expect(sent("set").map((call) => (call.args.item as { slots: { text: string }[] }).slots.map((slot) => slot.text))).toEqual([["", "07.00"], [""]]);
  });

  it("rejects a body that is not JSON, and one over 16 KiB", async () => {
    const headers = await humanSession();
    const notJson = await saveRoute(new Request(`${origin}${path}`, { method: "POST", headers: { "Content-Type": "application/json", Origin: origin, ...headers }, body: "{" }));
    await refusal(notJson, 400, "Body JSON tidak valid.");
    await refusal(await save({ id: ID_A, slots: [skip, { decision: "value", text: "x".repeat(16384) }] }, headers), 413, "Ukuran permintaan melebihi batas.");
    expect(sent("set")).toEqual([]);
  });

  it("rate limits per reviewer: 120 per 60 seconds", async () => {
    saving();
    await save(goodA);
    expect(answerLimits()).toEqual([{ command: "rate_limit", args: { bucket: "director-answers:director-test", limit: 120, seconds: 60 } }]);
  });

  it("answers 429 and sends no set when the rate limit is exhausted, before looking at the body", async () => {
    const headers = await humanSession();
    rateAllowed = false;
    expect((await save(goodA, headers)).status).toBe(429);
    expect((await save({ nonsense: true }, headers)).status).toBe(429);
    expect(sent("set")).toEqual([]);
  });

  it.each([
    ["no saved count", {}],
    ["a saved count of 2", { saved: 2 }],
    ["a saved count that is text", { saved: "1" }],
    ["an answer that is a list", [1]],
  ])("answers 503 for a store answer with %s", async (_name, answer) => {
    saving(answer);
    expect((await save(goodA)).status).toBe(503);
  });

  it("answers 503 when the store answers 503 or does not know the command", async () => {
    store = () => new Response("down", { status: 503 });
    expect((await save(goodA)).status).toBe(503);
    store = () => Response.json({ errorCode: "invalid_command" });
    expect((await save(goodA)).status).toBe(503);
  });

  it("never puts what the caller typed into an error message", async () => {
    const response = await save({ id: ID_A, slots: [skip, { decision: "value", text: "rahasia | pasien" }] });
    expect(JSON.stringify(await response.json())).not.toContain("rahasia");
  });
});

describe("director answers: list", () => {
  const list = async () => listRoute(request(path, "GET", undefined, await humanSession()));

  it("returns the stored answers of lines that are still in the queue", async () => {
    stored([ROW_B, ROW_A]);
    const response = await list();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ answers: [ROW_B, ROW_A], orphaned: [] });
    expect(sent("list")).toEqual([{ command: "list", args: {} }]);
    expect(urls[calls.findIndex((call) => call.command === "list")]).toMatch(/\/rpc\/melinda_director_answers$/);
    expect(answerLimits()).toEqual([]);
  });

  it("returns empty lists when nothing is stored", async () => {
    stored([]);
    expect(await (await list()).json()).toEqual({ answers: [], orphaned: [] });
  });

  it("moves a row whose line changed, and a row the queue does not hold, to orphaned", async () => {
    const changed = { ...ROW_A, lineText: "| Nomor | [ISI nomor] | Jam buka [ISI jam] s.d. 21.00 |" };
    const unknown = { ...ROW_B, id: "00000000000000cc" };
    stored([changed, unknown, ROW_B]);
    expect(await (await list()).json()).toEqual({ answers: [ROW_B], orphaned: [changed, unknown] });
  });

  it("moves a row whose placeholders no longer match the line to orphaned", async () => {
    const fewer = { ...ROW_A, slots: [ROW_A.slots[1]] };
    const moved = { ...ROW_B, slots: [{ ...ROW_B.slots[0], column: 25 }] };
    stored([fewer, moved]);
    expect(await (await list()).json()).toEqual({ answers: [], orphaned: [fewer, moved] });
  });

  it("moves a row the rules no longer accept to orphaned", async () => {
    const lockedNow = { ...ROW_A, slots: [{ ...ROW_A.slots[0], decision: "value", text: "001/SK" }, ROW_A.slots[1]] };
    stored([lockedNow]);
    expect(await (await list()).json()).toEqual({ answers: [], orphaned: [lockedNow] });
  });

  it("returns only the six fields of a row and the four of a slot", async () => {
    stored([{ ...ROW_B, extra: true, slots: [{ ...ROW_B.slots[0], extra: true }] }]);
    expect(await (await list()).json()).toEqual({ answers: [ROW_B], orphaned: [] });
  });

  it.each([
    ["answers that are not a list", { id: ID_A }],
    ["answers that are null", null],
    ["a row that is not an object", ["x"]],
    ["a row that is null", [null]],
    ["a row without an id", [{ ...ROW_A, id: undefined }]],
    ["a row whose docPath is not text", [{ ...ROW_A, docPath: 7 }]],
    ["a row whose lineText is not text", [{ ...ROW_A, lineText: null }]],
    ["a row whose answeredBy is not text", [{ ...ROW_A, answeredBy: 1 }]],
    ["a row whose answeredAt is not text", [{ ...ROW_A, answeredAt: 1 }]],
    ["a row whose slots are not a list", [{ ...ROW_A, slots: {} }]],
    ["a slot that is not an object", [{ ...ROW_A, slots: ["x"] }]],
    ["a slot whose column is not a number", [{ ...ROW_B, slots: [{ ...ROW_B.slots[0], column: "24" }] }]],
    ["a slot whose placeholder is not text", [{ ...ROW_B, slots: [{ ...ROW_B.slots[0], placeholder: 1 }] }]],
    ["a slot with an unknown decision", [{ ...ROW_B, slots: [{ ...ROW_B.slots[0], decision: "delete" }] }]],
    ["a slot whose text is not text", [{ ...ROW_B, slots: [{ ...ROW_B.slots[0], text: null }] }]],
  ])("answers 503 for %s", async (_name, answers) => {
    stored(answers);
    expect((await list()).status).toBe(503);
  });

  it("answers 503 when the store answer has no answers, or the store is down", async () => {
    store = () => Response.json({ other: [] });
    expect((await list()).status).toBe(503);
    store = () => new Response("down", { status: 503 });
    expect((await list()).status).toBe(503);
  });
});

describe("director answers: clear", () => {
  it("sends the id and returns the count from the store", async () => {
    clearing({ cleared: 1 });
    const response = await clear(`?id=${ID_A}`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ cleared: 1 });
    expect(sent("clear")).toEqual([{ command: "clear", args: { id: ID_A } }]);
    expect(urls[calls.findIndex((call) => call.command === "clear")]).toMatch(/\/rpc\/melinda_director_answers$/);
  });

  it("clears an id the queue no longer holds", async () => {
    clearing({ cleared: 0 });
    const response = await clear("?id=00000000000000cc");
    expect(await response.json()).toEqual({ cleared: 0 });
    expect(sent("clear")).toEqual([{ command: "clear", args: { id: "00000000000000cc" } }]);
  });

  it.each([
    ["no id", ""],
    ["an empty id", "?id="],
    ["15 characters", "?id=0000000000000aa"],
    ["upper case", "?id=00000000000000AA"],
    ["a path", "?id=..%2F..%2Fetc%2Fpasswd"],
  ])("rejects %s", async (_name, query) => {
    await refusal(await clear(query), 400, "Baris dokumen tidak dikenal.");
    expect(sent("clear")).toEqual([]);
  });

  it.each([
    ["no count", {}],
    ["a count of 2", { cleared: 2 }],
    ["a count that is text", { cleared: "1" }],
  ])("answers 503 for a store answer with %s", async (_name, answer) => {
    clearing(answer);
    expect((await clear(`?id=${ID_A}`)).status).toBe(503);
  });
});

describe("director answers: download", () => {
  const download = async () => downloadRoute(request(downloadPath, "GET", undefined, await humanSession()));

  it("returns one row per answered placeholder, in queue order, as an attachment", async () => {
    const orphan = { ...ROW_B, id: "00000000000000cc" };
    stored([ROW_B, orphan, ROW_A]);
    const before = Date.now();
    const response = await download();
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/json; charset=utf-8");
    expect(response.headers.get("Content-Disposition")).toBe(`attachment; filename="director-answers-${wibDate()}.json"`);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const body = await response.json() as { exportedAt: string; rows: unknown[] };
    expect(Object.keys(body)).toEqual(["exportedAt", "rows"]);
    expect(Date.parse(body.exportedAt)).toBeGreaterThanOrEqual(before - 1000);
    expect(body.rows).toEqual([
      { id: ID_A, docPath: DOC, lineText: LINE_A, column: 33, placeholder: "[ISI jam]", decision: "value", text: "07.00", answeredBy: "director-test", answeredAt: AT },
      { id: ID_B, docPath: DOC, lineText: LINE_B, column: 24, placeholder: "[CEK]", decision: "correction", text: "Seharusnya Logistik", answeredBy: "director-test", answeredAt: AT },
    ]);
  });

  it("returns no rows when nothing is stored", async () => {
    stored([]);
    expect((await (await download()).json() as { rows: unknown[] }).rows).toEqual([]);
  });

  it("answers 503 for a malformed store answer", async () => {
    stored([{ ...ROW_A, slots: {} }]);
    expect((await download()).status).toBe(503);
  });
});
