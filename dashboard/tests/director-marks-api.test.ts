import { scryptSync } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as listRoute, POST as saveRoute } from "@/app/api/director/marks/route";
import { POST as login } from "@/app/api/director/session/route";
import { EMAIL_HANDLING_VALUES } from "@/lib/director/director-marks-api";

const origin = "https://synthetic.example";
const salt = "00112233445566778899aabbccddeeff";
const passcodeHash = `scrypt$${salt}$${scryptSync("synthetic-test-passcode", salt, 64).toString("hex")}`;
const path = "/api/director/marks";

type Call = { command: string; args: Record<string, unknown> };
let calls: Call[];
let urls: string[];
let rateAllowed: boolean;
let session: { reviewerId: string } | null;
let store: (call: Call) => Response;

beforeEach(() => {
  calls = []; urls = []; rateAllowed = true; session = null;
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
    if (call.command === "rate_limit") return Response.json({ allowed: rateAllowed });
    if (call.command === "rate_reset") return Response.json({ ok: true });
    if (call.command === "session_create") { session = { reviewerId: "director-test" }; return Response.json({ ok: true }); }
    if (call.command === "session_read") return Response.json({ session });
    return store(call);
  });
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const sent = (command: string) => calls.filter((call) => call.command === command);
const marksLimits = () => sent("rate_limit").filter((call) => String(call.args.bucket).startsWith("director-marks:"));
function request(target: string, method: string, body?: unknown, headers: Record<string, string> = {}) {
  return new Request(`${origin}${target}`, { method, headers: { "Content-Type": "application/json", Origin: origin, ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
async function humanSession() {
  const response = await login(request("/api/director/session", "POST", { passcode: "synthetic-test-passcode" }));
  expect(response.status).toBe(200);
  const body = await response.json() as { csrfToken: string };
  return { Cookie: response.headers.get("set-cookie")!.split(";")[0], "X-CSRF-Token": body.csrfToken };
}
async function get(query: string) {
  return listRoute(request(`${path}${query}`, "GET", undefined, await humanSession()));
}
async function save(body: unknown, headers?: Record<string, string>) {
  return saveRoute(request(path, "POST", body, headers ?? await humanSession()));
}
async function refusal(response: Response, status: number, message: string) {
  expect(response.status).toBe(status);
  expect(await response.json()).toEqual({ error: message });
}
const stored = (marks: unknown) => { store = (call) => call.command === "list" ? Response.json({ marks }) : Response.json({ errorCode: "invalid_command" }); };
const DATE = "2026-11-11";
const replyItem = { key: "reply_001", value: "read" };
const mailItem = { key: "hai@melinda.co.id", value: "destri" };

describe("director marks: read", () => {
  it("refuses a caller without a session", async () => {
    await refusal(await listRoute(request(`${path}?scope=task_reply_read`, "GET")), 401, "Silakan masuk.");
    expect(sent("list")).toEqual([]);
  });

  it.each([
    ["an unknown scope", "?scope=bogus"],
    ["no scope", ""],
    ["an empty scope", "?scope="],
  ])("rejects %s with 400", async (_name, query) => {
    await refusal(await get(query), 400, "Jenis tanda tidak dikenal.");
    expect(sent("list")).toEqual([]);
  });

  it("refuses a date for task_reply_read, even an empty one", async () => {
    await refusal(await get(`?scope=task_reply_read&date=${DATE}`), 400, "Tanggal tidak berlaku untuk tanda ini.");
    await refusal(await get("?scope=task_reply_read&date="), 400, "Tanggal tidak berlaku untuk tanda ini.");
    expect(sent("list")).toEqual([]);
  });

  it.each([
    ["no date", "?scope=email_handling"],
    ["an empty date", "?scope=email_handling&date="],
    ["month 13 and day 40", "?scope=email_handling&date=2026-13-40"],
    ["the 30th of February", "?scope=email_handling&date=2026-02-30"],
    ["a date without leading zeros", "?scope=email_handling&date=2026-1-1"],
    ["a date with a time", "?scope=email_handling&date=2026-11-11T00:00"],
    ["year 0099, which Date.UTC would move to 1999", "?scope=email_handling&date=0099-01-01"],
  ])("rejects email_handling with %s", async (_name, query) => {
    await refusal(await get(query), 400, "Tanggal tidak valid.");
    expect(sent("list")).toEqual([]);
  });

  it("accepts the 29th of February in a leap year only", async () => {
    stored([]);
    expect((await get("?scope=email_handling&date=2028-02-29")).status).toBe(200);
    await refusal(await get("?scope=email_handling&date=2027-02-29"), 400, "Tanggal tidak valid.");
  });

  it("lists task_reply_read marks with only the scope, and sends them to the marks RPC", async () => {
    stored([{ key: "reply_001", value: "read" }, { key: "reply_002", value: "read" }]);
    const response = await get("?scope=task_reply_read&ignored=1");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ marks: [{ key: "reply_001", value: "read" }, { key: "reply_002", value: "read" }] });
    expect(sent("list")).toEqual([{ command: "list", args: { scope: "task_reply_read" } }]);
    expect(urls[calls.findIndex((call) => call.command === "list")]).toMatch(/\/rpc\/melinda_director_marks$/);
  });

  it("sends the date prefix for email_handling and returns keys without it", async () => {
    stored([{ key: "2026-11-11:hai@melinda.co.id", value: "destri" }, { key: "2026-11-11:a:b@melinda.co.id", value: "belum" }]);
    const response = await get(`?scope=email_handling&date=${DATE}`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ marks: [{ key: "hai@melinda.co.id", value: "destri" }, { key: "a:b@melinda.co.id", value: "belum" }] });
    expect(sent("list")).toEqual([{ command: "list", args: { scope: "email_handling", prefix: "2026-11-11:" } }]);
  });

  it("returns an empty list, and does not re-check the values the store returns", async () => {
    stored([]);
    expect(await (await get("?scope=task_reply_read")).json()).toEqual({ marks: [] });
    stored([{ key: "reply_001", value: "anything", extra: true }]);
    expect(await (await get("?scope=task_reply_read")).json()).toEqual({ marks: [{ key: "reply_001", value: "anything" }] });
  });

  it("has no rate limit of its own", async () => {
    stored([]);
    await get("?scope=task_reply_read");
    expect(marksLimits()).toEqual([]);
  });

  it.each([
    ["a key without the date prefix", `?scope=email_handling&date=${DATE}`, [{ key: "hai@melinda.co.id", value: "destri" }]],
    ["a key with another date", `?scope=email_handling&date=${DATE}`, [{ key: "2026-11-10:hai@melinda.co.id", value: "destri" }]],
    ["a row that is not an object", "?scope=task_reply_read", ["reply_001"]],
    ["a row that is null", "?scope=task_reply_read", [null]],
    ["a row without a value", "?scope=task_reply_read", [{ key: "reply_001" }]],
    ["a row whose value is not text", "?scope=task_reply_read", [{ key: "reply_001", value: 1 }]],
    ["a row whose key is not text", "?scope=task_reply_read", [{ key: 1, value: "read" }]],
    ["marks that are not a list", "?scope=task_reply_read", { key: "reply_001", value: "read" }],
    ["marks that are null", "?scope=task_reply_read", null],
  ])("answers 503 for %s", async (_name, query, marks) => {
    stored(marks);
    expect((await get(query)).status).toBe(503);
  });

  it("answers 503 when the store answer has no marks", async () => {
    store = () => Response.json({ other: [] });
    expect((await get("?scope=task_reply_read")).status).toBe(503);
  });

  it("answers 503 when the store answers 503 or does not know the command", async () => {
    store = () => new Response("down", { status: 503 });
    expect((await get("?scope=task_reply_read")).status).toBe(503);
    store = () => Response.json({ errorCode: "invalid_command" });
    expect((await get("?scope=task_reply_read")).status).toBe(503);
  });
});

describe("director marks: save", () => {
  const saved = (count = 1) => { store = (call) => call.command === "set" ? Response.json({ saved: count }) : Response.json({ errorCode: "invalid_command" }); };

  it("refuses a caller without a session and does not use the rate limit", async () => {
    await refusal(await saveRoute(request(path, "POST", { scope: "task_reply_read", items: [replyItem] })), 401, "Silakan masuk.");
    expect(marksLimits()).toEqual([]);
    expect(sent("set")).toEqual([]);
  });

  it("refuses a save without the CSRF token", async () => {
    const { Cookie } = await humanSession();
    expect((await save({ scope: "task_reply_read", items: [replyItem] }, { Cookie })).status).toBe(403);
    expect(sent("set")).toEqual([]);
  });

  it("refuses a save from a foreign origin even with a valid session and CSRF token", async () => {
    const response = await save({ scope: "task_reply_read", items: [replyItem] }, { ...await humanSession(), Origin: "https://evil.example" });
    expect(response.status).toBe(403);
    expect(sent("set")).toEqual([]);
  });

  it("rate limits per reviewer: 120 per 60 seconds", async () => {
    saved();
    await save({ scope: "task_reply_read", items: [replyItem] });
    expect(marksLimits()).toEqual([{ command: "rate_limit", args: { bucket: "director-marks:director-test", limit: 120, seconds: 60 } }]);
  });

  it("answers 429 and sends no set when the rate limit is exhausted, before looking at the body", async () => {
    const headers = await humanSession();
    rateAllowed = false;
    const response = await save({ scope: "task_reply_read", items: [replyItem] }, headers);
    expect(response.status).toBe(429);
    expect((await save({ nonsense: true }, headers)).status).toBe(429);
    expect(sent("set")).toEqual([]);
  });

  it("checks the body only after the rate limit allowed the request", async () => {
    await refusal(await save({ nonsense: true }), 400, "Format permintaan tidak valid.");
    expect(marksLimits().length).toBe(1);
  });

  it.each([
    ["no scope", { items: [replyItem] }],
    ["no items", { scope: "task_reply_read" }],
    ["an unknown body key", { scope: "task_reply_read", items: [replyItem], extra: 1 }],
    ["an item with an unknown key", { scope: "task_reply_read", items: [{ ...replyItem, extra: 1 }] }],
    ["an item without a value", { scope: "task_reply_read", items: [{ key: "reply_001" }] }],
    ["an item that is not an object", { scope: "task_reply_read", items: ["reply_001"] }],
    ["an item that is a list", { scope: "task_reply_read", items: [["reply_001", "read"]] }],
    ["a body that is a list", [replyItem]],
    ["a body that is null", null],
  ])("rejects %s with the format message", async (_name, body) => {
    await refusal(await save(body), 400, "Format permintaan tidak valid.");
    expect(sent("set")).toEqual([]);
  });

  it("rejects a body that is not JSON, and one over 32 KiB", async () => {
    const headers = await humanSession();
    const notJson = await saveRoute(new Request(`${origin}${path}`, { method: "POST", headers: { "Content-Type": "application/json", Origin: origin, ...headers }, body: "{" }));
    await refusal(notJson, 400, "Body JSON tidak valid.");
    const big = await save({ scope: "task_reply_read", items: [{ key: "reply_001", value: "x".repeat(40000) }] }, headers);
    await refusal(big, 413, "Ukuran permintaan melebihi batas.");
    expect(sent("set")).toEqual([]);
  });

  it.each([
    ["an unknown scope", { scope: "bogus", items: [replyItem] }],
    ["a scope that is not text", { scope: 1, items: [replyItem] }],
  ])("rejects %s", async (_name, body) => {
    await refusal(await save(body), 400, "Jenis tanda tidak dikenal.");
    expect(sent("set")).toEqual([]);
  });

  it.each([
    ["empty items", []],
    ["201 items", Array.from({ length: 201 }, (_, index) => ({ key: `reply_${index}`, value: "read" }))],
    ["items that are not a list", { key: "reply_001", value: "read" }],
    ["items that are text", "reply_001"],
    ["items that are null", null],
  ])("rejects %s with the count message", async (_name, items) => {
    await refusal(await save({ scope: "task_reply_read", items }), 400, "Daftar tanda harus berisi 1 sampai 200 butir.");
    expect(sent("set")).toEqual([]);
  });

  it("accepts exactly 200 items", async () => {
    saved(200);
    const items = Array.from({ length: 200 }, (_, index) => ({ key: `reply_${index}`, value: "read" }));
    const response = await save({ scope: "task_reply_read", items });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ saved: 200 });
    expect(sent("set")[0].args.items).toEqual(items);
  });

  describe("task_reply_read", () => {
    it("refuses a date", async () => {
      await refusal(await save({ scope: "task_reply_read", date: DATE, items: [replyItem] }), 400, "Tanggal tidak berlaku untuk tanda ini.");
      expect(sent("set")).toEqual([]);
    });

    it.each([
      ["a key with a space and a symbol", "bad key!"],
      ["an empty key", ""],
      ["a key over 80 characters", "a".repeat(81)],
      ["a key with a colon", "2026-11-11:reply"],
      ["a key that is not text", 5],
      ["a key that is null", null],
    ])("rejects %s", async (_name, key) => {
      await refusal(await save({ scope: "task_reply_read", items: [{ key, value: "read" }] }), 400, "Kunci tanda tidak valid.");
      expect(sent("set")).toEqual([]);
    });

    it.each([
      ["the mailbox value seen", "seen"],
      ["a mailbox status", "belum"],
      ["upper case Read", "Read"],
      ["an empty value", ""],
      ["a value that is not text", true],
    ])("rejects %s as a value", async (_name, value) => {
      await refusal(await save({ scope: "task_reply_read", items: [{ key: "reply_001", value }] }), 400, "Nilai tanda tidak dikenal.");
      expect(sent("set")).toEqual([]);
    });

    it("sends set with the reviewer from the session and returns the count from the store", async () => {
      saved(2);
      const items = [replyItem, { key: "a".repeat(80), value: "read" }];
      const response = await save({ scope: "task_reply_read", items });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ saved: 2 });
      expect(sent("set")).toEqual([{ command: "set", args: { scope: "task_reply_read", reviewer: "director-test", items } }]);
      expect(urls[calls.findIndex((call) => call.command === "set")]).toMatch(/\/rpc\/melinda_director_marks$/);
    });

    it("sends only key and value of each item", async () => {
      saved();
      await save({ scope: "task_reply_read", items: [replyItem] });
      expect(Object.keys(sent("set")[0].args.items as object[])).toEqual(["0"]);
      expect(Object.keys((sent("set")[0].args.items as object[])[0])).toEqual(["key", "value"]);
    });
  });

  describe("email_handling", () => {
    it("requires a date", async () => {
      await refusal(await save({ scope: "email_handling", items: [mailItem] }), 400, "Tanggal tidak valid.");
      expect(sent("set")).toEqual([]);
    });

    it.each([
      ["a date that does not exist", "2026-02-30"],
      ["month 13", "2026-13-40"],
      ["a date in the wrong format", "11-11-2026"],
      ["a date that is not text", 20261111],
      ["a date that is null", null],
    ])("rejects %s", async (_name, date) => {
      await refusal(await save({ scope: "email_handling", date, items: [mailItem] }), 400, "Tanggal tidak valid.");
      expect(sent("set")).toEqual([]);
    });

    it.each([
      ["a personal mailbox", "pribadi@gmail.com"],
      ["a mailbox with a newline", "hai@melinda.co.id\n"],
      ["a mailbox with a newline inside", "hai@mel\ninda.co.id"],
      ["a mailbox with a tab", "hai\t@melinda.co.id"],
      ["a mailbox with DEL", "hai\u007f@melinda.co.id"],
      ["a mailbox with a leading space", " hai@melinda.co.id"],
      ["a mailbox with a trailing space", "hai@melinda.co.id "],
      ["a mailbox that is too short", "mel"],
      ["a mailbox over 120 characters", `melinda${"a".repeat(114)}`],
      ["an empty mailbox", ""],
    ])("rejects %s", async (_name, key) => {
      await refusal(await save({ scope: "email_handling", date: DATE, items: [{ key, value: "belum" }] }), 400, "Kotak surat tidak dikenal.");
      expect(sent("set")).toEqual([]);
    });

    it("rejects a mailbox that is not text with the key message", async () => {
      await refusal(await save({ scope: "email_handling", date: DATE, items: [{ key: 7, value: "belum" }] }), 400, "Kunci tanda tidak valid.");
      expect(sent("set")).toEqual([]);
    });

    it.each([
      ["selesai", "selesai"],
      ["the read value", "read"],
      ["upper case", "Destri"],
      ["not text", 1],
    ])("rejects the value %s", async (_name, value) => {
      await refusal(await save({ scope: "email_handling", date: DATE, items: [{ key: "hai@melinda.co.id", value }] }), 400, "Nilai tanda tidak dikenal.");
      expect(sent("set")).toEqual([]);
    });

    it("exposes the three allowed values", () => {
      expect(EMAIL_HANDLING_VALUES).toEqual(["belum", "destri", "eskalasi"]);
    });

    it("prefixes the stored key with the date and keeps the mailbox as sent", async () => {
      saved(3);
      const items = [mailItem, { key: "Hai@MELINDA.co.id", value: "eskalasi" }, { key: `melinda${"a".repeat(113)}`, value: "belum" }];
      const response = await save({ scope: "email_handling", date: DATE, items });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ saved: 3 });
      expect(sent("set")).toEqual([{ command: "set", args: { scope: "email_handling", reviewer: "director-test", items: [
        { key: "2026-11-11:hai@melinda.co.id", value: "destri" },
        { key: "2026-11-11:Hai@MELINDA.co.id", value: "eskalasi" },
        { key: `2026-11-11:melinda${"a".repeat(113)}`, value: "belum" },
      ] } }]);
    });
  });

  it("stops at the first bad item and sends nothing, even when earlier items are good", async () => {
    await refusal(await save({ scope: "task_reply_read", items: [replyItem, { key: "bad key!", value: "read" }] }), 400, "Kunci tanda tidak valid.");
    expect(sent("set")).toEqual([]);
  });

  it.each([
    ["no saved count", {}],
    ["a saved count that is text", { saved: "1" }],
    ["a saved count that is null", { saved: null }],
  ])("answers 503 for a store answer with %s", async (_name, answer) => {
    store = (call) => call.command === "set" ? Response.json(answer) : Response.json({ errorCode: "invalid_command" });
    expect((await save({ scope: "task_reply_read", items: [replyItem] })).status).toBe(503);
  });

  it("answers 503 when the store answers 503 or does not know the command", async () => {
    store = () => new Response("down", { status: 503 });
    expect((await save({ scope: "task_reply_read", items: [replyItem] })).status).toBe(503);
    store = () => Response.json({ errorCode: "invalid_command" });
    expect((await save({ scope: "task_reply_read", items: [replyItem] })).status).toBe(503);
  });

  it("never puts what the caller sent into an error message", async () => {
    const response = await save({ scope: "email_handling", date: DATE, items: [{ key: "secret-person@gmail.com", value: "belum" }] });
    expect(JSON.stringify(await response.json())).not.toContain("secret-person");
  });
});
