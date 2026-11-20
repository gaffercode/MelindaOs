import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearAnswer, fetchAnswers, saveAnswer } from "@/components/knowledge/document-answers-client";

const ROW = { id: "00000000000000aa", docPath: "knowledge/01_HOSPITAL/x.md", lineText: "| Jam buka | [ISI jam] |", answeredBy: "director-test", answeredAt: "2026-11-12T03:00:00+00:00", slots: [
  { column: 13, placeholder: "[ISI jam]", decision: "value", text: "07.00" },
] };
const PATH = "/api/director/document-answers";

type Call = { url: string; method: string; headers: Record<string, string>; body: unknown };
let calls: Call[];
let answer: () => Response;

beforeEach(() => {
  calls = [];
  answer = () => Response.json({ answers: [ROW], orphaned: [] });
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    calls.push({ url, method: init.method ?? "GET", headers: (init.headers ?? {}) as Record<string, string>, body: typeof init.body === "string" ? JSON.parse(init.body) : undefined });
    if (url === "/api/director/session") return Response.json({ csrfToken: "csrf-test" });
    return answer();
  }));
});
afterEach(() => { vi.unstubAllGlobals(); });

const apiCalls = () => calls.filter((call) => call.url.startsWith(PATH));

describe("fetchAnswers", () => {
  it("returns both lists", async () => {
    answer = () => Response.json({ answers: [ROW], orphaned: [{ ...ROW, id: "00000000000000bb" }] });
    expect(await fetchAnswers()).toEqual({ answers: [ROW], orphaned: [{ ...ROW, id: "00000000000000bb" }] });
    expect(apiCalls()).toMatchObject([{ url: PATH, method: "GET" }]);
  });

  it.each([
    ["no orphaned list", { answers: [ROW] }],
    ["answers that are not a list", { answers: ROW, orphaned: [] }],
    ["a row without an id", { answers: [{ ...ROW, id: undefined }], orphaned: [] }],
    ["a row that is null", { answers: [null], orphaned: [] }],
    ["a row whose slots are not a list", { answers: [{ ...ROW, slots: {} }], orphaned: [] }],
    ["a slot with an unknown decision", { answers: [{ ...ROW, slots: [{ ...ROW.slots[0], decision: "delete" }] }], orphaned: [] }],
    ["a slot whose column is text", { answers: [], orphaned: [{ ...ROW, slots: [{ ...ROW.slots[0], column: "13" }] }] }],
    ["a body that is a list", [ROW]],
  ])("throws for %s", async (_name, body) => {
    answer = () => Response.json(body);
    await expect(fetchAnswers()).rejects.toThrow("Jawaban tersimpan tidak dikenal.");
  });

  it("throws the API's error text, or its own when the answer has none", async () => {
    answer = () => Response.json({ error: "Daftar isian belum tersedia." }, { status: 503 });
    await expect(fetchAnswers()).rejects.toThrow("Daftar isian belum tersedia.");
    answer = () => new Response("down", { status: 502 });
    await expect(fetchAnswers()).rejects.toThrow("Jawaban belum dapat dibaca.");
  });
});

describe("saveAnswer", () => {
  it("posts the id and the slots with the CSRF header", async () => {
    answer = () => Response.json({ saved: 1 });
    await saveAnswer(ROW.id, [{ decision: "value", text: "07.00" }]);
    expect(apiCalls()).toEqual([{ url: PATH, method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": "csrf-test" }, body: { id: ROW.id, slots: [{ decision: "value", text: "07.00" }] } }]);
  });

  it("throws the API's error text", async () => {
    answer = () => Response.json({ error: "Isian tidak valid." }, { status: 400 });
    await expect(saveAnswer(ROW.id, [{ decision: "value", text: "|" }])).rejects.toThrow("Isian tidak valid.");
  });
});

describe("clearAnswer", () => {
  it("sends DELETE with the id and the CSRF header", async () => {
    answer = () => Response.json({ cleared: 1 });
    await clearAnswer(ROW.id);
    expect(apiCalls()).toEqual([{ url: `${PATH}?id=${ROW.id}`, method: "DELETE", headers: { "X-CSRF-Token": "csrf-test" }, body: undefined }]);
  });

  it("throws the API's error text", async () => {
    answer = () => Response.json({ error: "Baris dokumen tidak dikenal." }, { status: 400 });
    await expect(clearAnswer("x")).rejects.toThrow("Baris dokumen tidak dikenal.");
  });
});
