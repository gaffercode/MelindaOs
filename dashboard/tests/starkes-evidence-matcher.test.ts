import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DriveFile } from "../lib/starkes/drive-source";
import { matchFile } from "../lib/starkes/evidence-matcher";
import { loadRequirementRegister } from "../lib/starkes/requirements";

const skp = loadRequirementRegister().requirements.filter((ep) => ep.chapterCode === "SKP");
const file: DriveFile = { id: "f1", name: "Audit gelang identitas Oktober.pdf", mimeType: "application/pdf", modifiedTime: "2026-11-01T00:00:00Z", webViewLink: "", chapterCode: "SKP", trashed: false };
let reply: Record<string, unknown>;
let sent: string[];

beforeEach(() => {
  sent = [];
  vi.stubEnv("ANTHROPIC_API_KEY", "synthetic-anthropic-key");
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
    sent.push(JSON.parse(String(init.body)).messages[0].content);
    return Response.json({ content: [{ type: "text", text: JSON.stringify(reply) }], stop_reason: "end_turn" });
  });
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("matchFile", () => {
  it("drops EP ids from other chapters and unknown ids", async () => {
    reply = { epIds: ["47104-2024:PPI:1:1", "47104-2024:SKP:1:2", "made-up"], kind: "D", confidence: 0.8 };
    expect(await matchFile(file, "", skp)).toEqual({ epIds: ["47104-2024:SKP:1:2"], kind: "D", confidence: 0.8, phiFlag: false });
  });
  it("returns null when no chapter EP remains", async () => {
    reply = { epIds: ["47104-2024:PPI:1:1"], kind: "D", confidence: 0.9 };
    expect(await matchFile(file, "", skp)).toBeNull();
  });
  it("sends neither text nor name when they carry patient identifiers", async () => {
    reply = { epIds: ["47104-2024:SKP:1:1"], kind: "O", confidence: 0.5 };
    const result = await matchFile({ ...file, name: "Ny. Sari gelang.jpg" }, "No. RM 123456", skp);
    expect(result?.phiFlag).toBe(true);
    expect(sent[0]).not.toContain("123456");
    expect(sent[0]).not.toContain("Sari");
  });
});
