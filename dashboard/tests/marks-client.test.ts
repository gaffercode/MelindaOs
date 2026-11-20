import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchMarks, missingOnServer, saveMarks } from "@/components/marks-client";

afterEach(() => vi.unstubAllGlobals());

type Call = { url: string; init: RequestInit };
function stubFetch(answer: (call: Call, index: number) => Response) {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    return answer({ url, init }, calls.length - 1);
  });
  return calls;
}
const items = (count: number) => Array.from({ length: count }, (_, index) => ({ key: `r-${index}`, value: "read" }));
const bodyOf = (call: Call): { scope: string; items: { key: string; value: string }[]; date?: string } => JSON.parse(String(call.init.body));

describe("missingOnServer", () => {
  it("returns nothing for empty inputs", () => {
    expect(missingOnServer([], [])).toEqual([]);
    expect(missingOnServer([], [{ key: "a", value: "read" }])).toEqual([]);
  });
  it("returns every local entry when the server has none", () => {
    const local = [{ key: "a", value: "read" }, { key: "b", value: "read" }];
    expect(missingOnServer(local, [])).toEqual(local);
  });
  it("returns nothing on full overlap", () => {
    const local = [{ key: "a", value: "read" }, { key: "b", value: "read" }];
    expect(missingOnServer(local, [...local].reverse())).toEqual([]);
  });
  it("returns only the entries the server lacks, in order", () => {
    const local = [{ key: "c", value: "read" }, { key: "a", value: "read" }, { key: "b", value: "read" }];
    expect(missingOnServer(local, [{ key: "a", value: "read" }])).toEqual([{ key: "c", value: "read" }, { key: "b", value: "read" }]);
  });
  it("does not return a key the server has with a different value", () => {
    expect(missingOnServer([{ key: "a", value: "belum" }], [{ key: "a", value: "eskalasi" }])).toEqual([]);
  });
});

describe("fetchMarks", () => {
  it("reads the scope and returns plain marks", async () => {
    const calls = stubFetch(() => Response.json({ marks: [{ key: "r-1", value: "read", extra: 1 }] }));
    await expect(fetchMarks("task_reply_read")).resolves.toEqual([{ key: "r-1", value: "read" }]);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("/api/director/marks?scope=task_reply_read");
  });
  it("adds the date when given", async () => {
    const calls = stubFetch(() => Response.json({ marks: [] }));
    await expect(fetchMarks("email_handling", { date: "2026-11-11" })).resolves.toEqual([]);
    expect(calls[0].url).toBe("/api/director/marks?scope=email_handling&date=2026-11-11");
  });
  it("passes the abort signal to fetch", async () => {
    const calls = stubFetch(() => Response.json({ marks: [] }));
    const controller = new AbortController();
    await fetchMarks("task_reply_read", { signal: controller.signal });
    expect(calls[0].init.signal).toBe(controller.signal);
  });
  it("rejects on HTTP 503", async () => {
    stubFetch(() => Response.json({ error: "Layanan belum tersedia." }, { status: 503 }));
    await expect(fetchMarks("task_reply_read")).rejects.toThrow();
  });
  it.each([
    ["no marks field", {}],
    ["marks not an array", { marks: "x" }],
    ["an entry that is not an object", { marks: ["a"] }],
    ["a null entry", { marks: [null] }],
    ["a key that is not a string", { marks: [{ key: 1, value: "read" }] }],
    ["a value that is not a string", { marks: [{ key: "a", value: null }] }],
    ["a missing value", { marks: [{ key: "a" }] }],
  ])("rejects an answer with %s", async (_label, answer) => {
    stubFetch(() => Response.json(answer));
    await expect(fetchMarks("task_reply_read")).rejects.toThrow();
  });
});

describe("saveMarks", () => {
  it("sends nothing for no items", async () => {
    const calls = stubFetch(() => Response.json({ saved: 0 }));
    await saveMarks("task_reply_read", [], "csrf-1");
    expect(calls).toHaveLength(0);
  });
  it("posts one request with the token, scope and items, and no date unless given", async () => {
    const calls = stubFetch(() => Response.json({ saved: 1 }));
    await saveMarks("task_reply_read", items(1), "csrf-1");
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("/api/director/marks");
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.headers).toMatchObject({ "X-CSRF-Token": "csrf-1", "Content-Type": "application/json" });
    expect(bodyOf(calls[0])).toEqual({ scope: "task_reply_read", items: items(1) });
    expect("date" in bodyOf(calls[0])).toBe(false);
  });
  it("includes the date when given", async () => {
    const calls = stubFetch(() => Response.json({ saved: 1 }));
    await saveMarks("email_handling", [{ key: "melinda@x.test", value: "destri" }], "csrf-1", "2026-11-11");
    expect(bodyOf(calls[0])).toEqual({ scope: "email_handling", date: "2026-11-11", items: [{ key: "melinda@x.test", value: "destri" }] });
  });
  it("splits 450 items into requests of 200, 200 and 50, one after the other", async () => {
    let running = 0, overlap = false;
    const calls: Call[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      running += 1; overlap ||= running > 1;
      await new Promise((resolve) => setTimeout(resolve, 5));
      running -= 1;
      return Response.json({ saved: 1 });
    });
    const all = items(450);
    await saveMarks("task_reply_read", all, "csrf-2");
    expect(calls.map((call) => bodyOf(call).items.length)).toEqual([200, 200, 50]);
    expect(calls.flatMap((call) => bodyOf(call).items)).toEqual(all);
    for (const call of calls) expect(call.init.headers).toMatchObject({ "X-CSRF-Token": "csrf-2" });
    expect(overlap).toBe(false);
  });
  it("rejects and stops at the first request that answers 503", async () => {
    const calls = stubFetch((_call, index) => index === 1 ? Response.json({ error: "x" }, { status: 503 }) : Response.json({ saved: 200 }));
    await expect(saveMarks("task_reply_read", items(450), "csrf-3")).rejects.toThrow();
    expect(calls).toHaveLength(2);
  });
});
