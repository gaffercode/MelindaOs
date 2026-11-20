import { scryptSync } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CLAUDE_ENDPOINT } from "@/lib/claude-client";
import { detectFacts } from "@/lib/composer/facts";
import { composeAndStoreBrief } from "@/lib/composer/run";
import { requireConfiguration } from "@/lib/director/director-api";
import { clearDailyDocumentCache } from "@/lib/daily/daily-documents";
import { parseMelindaBrief } from "@/lib/melinda/melinda-brief-contract";
import { snapshot } from "./fixtures/medify-snapshot";

const salt = "00112233445566778899aabbccddeeff";
const passcodeHash = `scrypt$${salt}$${scryptSync("synthetic-test-passcode", salt, 64).toString("hex")}`;
const hash = "a".repeat(64);
const snap = snapshot({});
const texts = { serviceSummary: "Okupansi perlu dipantau.", safetyQuality: "", pharmacy: "", staffing: "", decisions: [], conclusion: ["Perlu perhatian Direktur."] };
const modelOk = (value: unknown = texts) => async () => Response.json({ content: [{ type: "text", text: JSON.stringify(value) }], stop_reason: "end_turn" });
const modelDown = async () => new Response("", { status: 500 });

type Row = { id: string; kind: string; report_date: string; producer: string; request_key: string; payload: unknown; payload_hash: string; received_at: string };
let rows: Row[];
let allowed: boolean;
let readDown: boolean;
let model: () => Promise<Response>;
let modelRequests: number;
let limitRequests: Record<string, unknown>[];
const storedKinds = () => rows.map((row) => row.kind);
const storedPayload = () => rows.at(-1)?.payload;
const infoLines = (code: string) => vi.mocked(console.info).mock.calls.map(([line]) => JSON.parse(String(line))).filter((line) => line.code === code);
const runLines = () => infoLines("brief_composer_run");

beforeEach(() => {
  rows = []; allowed = true; readDown = false; model = modelOk(); modelRequests = 0; limitRequests = [];
  vi.stubEnv("MELINDAOS_DIRECTOR_STORE", "supabase");
  vi.stubEnv("MELINDAOS_APP_ORIGIN", "https://synthetic.example");
  vi.stubEnv("MELINDAOS_SUPABASE_URL", "https://synthetic.supabase.co");
  vi.stubEnv("MELINDAOS_SUPABASE_SECRET_KEY", "sb_secret_synthetic");
  vi.stubEnv("MELINDAOS_REVIEWER_PASSCODE_HASH", passcodeHash);
  vi.stubEnv("MELINDAOS_REVIEWER_ID", "director-test");
  vi.stubEnv("ANTHROPIC_API_KEY", "synthetic-anthropic-key");
  vi.stubEnv("MELINDAOS_CLAUDE_API_KEY", "");
  vi.stubEnv("MELINDAOS_BRIEF_MODEL", "");
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    if (url === CLAUDE_ENDPOINT) { modelRequests += 1; return model(); }
    const { command, args } = JSON.parse(init.body as string) as { command: string; args: Record<string, unknown> };
    if (command === "rate_limit") { limitRequests.push(args); return Response.json({ allowed }); }
    if (command === "board") return Response.json({ instructions: [] });
    expect(url).toContain("/rpc/melinda_daily_documents");
    if (command === "submit") {
      const existing = rows.find((row) => row.kind === args.kind && row.producer === args.producerId && row.request_key === args.key);
      if (existing) return existing.payload_hash === args.payloadHash ? Response.json({ replayed: true, id: existing.id, kind: existing.kind, date: existing.report_date, payloadHash: existing.payload_hash, receivedAt: existing.received_at }) : Response.json({ errorCode: "conflict" });
      const row: Row = { id: `00000000-0000-4000-8000-${String(rows.length + 1).padStart(12, "0")}`, kind: args.kind as string, report_date: args.date as string, producer: args.producerId as string, request_key: args.key as string, payload: args.payload, payload_hash: args.payloadHash as string, received_at: "2099-01-15T03:00:00.000Z" };
      rows.push(row);
      return Response.json({ replayed: false, id: row.id, kind: row.kind, date: row.report_date, payloadHash: row.payload_hash, receivedAt: row.received_at });
    }
    if (command === "read" && readDown) return new Response("down", { status: 503 });
    if (command === "read") return Response.json({ document: rows.filter((row) => row.kind === args.kind && row.report_date === args.date).at(-1) ?? null });
    return Response.json({ errorCode: "invalid_command" });
  });
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); clearDailyDocumentCache(); });

describe("composeAndStoreBrief", () => {
  it("stores a brief with analysis", async () => {
    expect(await composeAndStoreBrief(requireConfiguration(), snap, hash)).toBe("stored");
    expect(storedKinds()).toEqual(["management_brief"]);
    expect(parseMelindaBrief(storedPayload()).status).toBe("Otomatis");
    expect(parseMelindaBrief(storedPayload()).composer).toMatchObject({ outcome: "stored", modelCalled: true, facts: detectFacts(snap).length, decisions: 0 });
    expect(runLines()).toEqual([{ level: "info", code: "brief_composer_run", outcome: "stored", facts: detectFacts(snap).length, model: "called" }]);
  });

  it("counts a paragraph the checks dropped and names the outcome in one line each", async () => {
    model = modelOk({ ...texts, safetyQuality: "Ada 999 kasus." });
    expect(await composeAndStoreBrief(requireConfiguration(), snap, hash)).toBe("stored");
    expect(infoLines("ai_brief_checked")).toEqual([{ level: "info", code: "ai_brief_checked", paragraphsKept: 1, paragraphsDropped: 1, decisionsKept: 0, decisionsDropped: 0, conclusionKept: 1, conclusionDropped: 0 }]);
    expect(runLines()).toEqual([{ level: "info", code: "brief_composer_run", outcome: "stored", facts: detectFacts(snap).length, model: "called" }]);
  });

  it("stores a brief without analysis when the model fails and none exists", async () => {
    model = modelDown;
    expect(await composeAndStoreBrief(requireConfiguration(), snap, hash)).toBe("stored_without_analysis");
    expect(parseMelindaBrief(storedPayload()).status).toBe("Otomatis, tanpa analisis");
    expect(parseMelindaBrief(storedPayload()).composer).toMatchObject({ outcome: "stored_without_analysis", modelCalled: true, decisions: 0 });
  });

  it("keeps the morning brief when the evening model call fails", async () => {
    const config = requireConfiguration();
    expect(await composeAndStoreBrief(config, snap, hash)).toBe("stored");
    model = modelDown;
    expect(await composeAndStoreBrief(config, snap, "b".repeat(64))).toBe("kept_existing");
    expect(storedKinds()).toHaveLength(1);
    expect(runLines().map((line) => line.outcome)).toEqual(["stored", "kept_existing"]);
    expect(runLines()[1]).toEqual({ level: "info", code: "brief_composer_run", outcome: "kept_existing", facts: detectFacts(snap).length, model: "called" });
  });

  it("does not replace the morning brief when the store cannot be read", async () => {
    const config = requireConfiguration();
    expect(await composeAndStoreBrief(config, snap, hash)).toBe("stored");
    model = modelDown; readDown = true;
    expect(await composeAndStoreBrief(config, snap, "b".repeat(64))).toBe("skipped");
    expect(storedKinds()).toHaveLength(1);
    expect(runLines().map((line) => line.outcome)).toEqual(["stored", "skipped"]);
  });

  it("stores nothing without analysis when the store cannot be read and no brief is known", async () => {
    model = modelDown; readDown = true;
    expect(await composeAndStoreBrief(requireConfiguration(), snap, hash)).toBe("skipped");
    expect(storedKinds()).toHaveLength(0);
  });

  it("makes no model call once the daily limit is reached", async () => {
    allowed = false;
    expect(await composeAndStoreBrief(requireConfiguration(), snap, hash)).toBe("stored_without_analysis");
    expect(modelRequests).toBe(0);
    expect(limitRequests).toEqual([{ bucket: "brief-composer", limit: 4, seconds: 86_400 }]);
    expect(runLines()).toEqual([{ level: "info", code: "brief_composer_run", outcome: "stored_without_analysis", facts: detectFacts(snap).length, model: "rate_limited" }]);
    expect(infoLines("ai_brief_checked")).toEqual([]);
  });

  it("logs the failing contract path, never its content, when the composed brief breaks the contract", async () => {
    const tooMany = snapshot({ staffByType: Array.from({ length: 101 }, (_, index): [string, number] => [`Jenis sintetis ${index + 1}`, 1]) });
    expect(await composeAndStoreBrief(requireConfiguration(), tooMany, hash)).toBe("skipped");
    expect(storedKinds()).toHaveLength(0);
    expect(infoLines("brief_composer_invalid_path")).toEqual([{ level: "info", code: "brief_composer_invalid_path", path: "brief.staffing.items" }]);
    expect(runLines()).toEqual([{ level: "info", code: "brief_composer_run", outcome: "skipped", facts: detectFacts(tooMany).length, model: "called" }]);
    expect(JSON.stringify(vi.mocked(console.info).mock.calls)).not.toContain("Jenis sintetis");
  });

  it("still stores the brief when one staff label looks like a patient identifier", async () => {
    const withIdentifier = snapshot({ staffByType: [["Tetap", 40], ["Ny. Sintetis", 3]] });
    expect(await composeAndStoreBrief(requireConfiguration(), withIdentifier, hash)).not.toBe("skipped");
    expect(JSON.stringify(storedPayload())).not.toContain("Ny. Sintetis");
  });

  it("skips without throwing when the same snapshot yields a different brief", async () => {
    const config = requireConfiguration();
    expect(await composeAndStoreBrief(config, snap, hash)).toBe("stored");
    model = modelOk({ ...texts, conclusion: ["Tidak ada perubahan."] });
    expect(await composeAndStoreBrief(config, snap, hash)).toBe("skipped");
    expect(storedKinds()).toHaveLength(1);
    expect(runLines().map((line) => line.outcome)).toEqual(["stored", "skipped"]);
  });
});
