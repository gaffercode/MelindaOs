import { describe, expect, it } from "vitest";
import type { DirectorAuthConfiguration } from "@/lib/director/director-auth";
import type { McpAuthContext } from "@/lib/mcp/auth";
import { executeMcpTool, McpToolError, MCP_TOOLS } from "@/lib/mcp/tools";

const NOW = new Date("2026-11-22T03:00:00Z"); // 10:00 WIB, Sunday

const handoverRow = {
  id: "00000000-0000-4000-8000-000000000001", kind: "handover", date: "2026-11-22", shift: "malam", unit: "Rawat inap",
  payload: { patient: "Ny. Pasien QA", rm: "123456", room: "Aster 2", situation: "Demam 3 hari", background: "", assessment: "", recommendation: "Pantau suhu", pending: "Cek lab", from: "Ns. A", to: "Ns. B" },
  status: "aktif", revision: 1, createdBy: "Direktur", createdAt: "2026-11-22T01:00:00Z", updatedBy: null, updatedAt: null,
};

function context(opts: { rows?: unknown[]; auditFails?: boolean } = {}) {
  const calls: { command: string; args: Record<string, unknown> }[] = [];
  const config = {
    store: {
      call: async (command: string, args: Record<string, unknown>) => {
        calls.push({ command, args });
        if (command === "list") return { entries: opts.rows ?? [] };
        if (command === "audit_read") {
          if (opts.auditFails) throw new Error("unreachable");
          return { ok: true };
        }
        throw new Error(`unexpected command ${command}`);
      },
    },
  } as unknown as DirectorAuthConfiguration;
  const ctx: McpAuthContext = { agentId: "ALL_ACCESS", mode: "master_token", config };
  return { ctx, calls };
}

describe("clinical MCP read tools", () => {
  it("lists the three tools with only optional, bounded arguments", () => {
    for (const name of ["baca_handover", "baca_roster", "baca_insiden"]) {
      const tool = MCP_TOOLS.find((candidate) => candidate.name === name);
      expect(tool, name).toBeDefined();
      expect(tool?.inputSchema.required).toEqual([]);
      expect(tool?.inputSchema.additionalProperties).toBe(false);
    }
  });

  it("answers with Indonesian keys and writes one audit row naming the caller mode and the row count", async () => {
    const { ctx, calls } = context({ rows: [handoverRow] });
    const result = (await executeMcpTool("baca_handover", { date: "2026-11-22" }, ctx, NOW)) as { status: string; jumlah: number; entri: Record<string, unknown>[] };
    expect(result.status).toBe("ok");
    expect(result.jumlah).toBe(1);
    expect(result.entri[0]).toMatchObject({ tanggal: "2026-11-22", shift: "malam", pasien: "Ny. Pasien QA", no_rm: "123456", rekomendasi: "Pantau suhu", diserahkan_oleh: "Ns. A" });
    expect(calls.map((call) => call.command)).toEqual(["list", "audit_read"]);
    expect(calls[0].args).toMatchObject({ kind: "handover", from: "2026-11-22", to: "2026-11-22", status: "aktif" });
    expect(calls[1].args).toEqual({ kind: "handover", reader: "master_token", count: 1, detail: { from: "2026-11-22", to: "2026-11-22", limit: 50, ids: [handoverRow.id] } });
    expect(result).toMatchObject({ mungkin_terpotong: false });
  });

  it("defaults to the last seven days in WIB", async () => {
    const { ctx, calls } = context();
    await executeMcpTool("baca_roster", {}, ctx, NOW);
    expect(calls[0].args).toMatchObject({ kind: "roster", from: "2026-11-16", to: "2026-11-22" });
  });

  it("does not return data when the audit row cannot be written", async () => {
    const { ctx } = context({ rows: [handoverRow], auditFails: true });
    await expect(executeMcpTool("baca_handover", {}, ctx, NOW)).rejects.toThrow(McpToolError);
    await expect(executeMcpTool("baca_handover", {}, ctx, NOW)).rejects.toThrow(/data klinis tidak dikirim/);
  });

  it("answers 'tidak_tersedia' without a database", async () => {
    const result = await executeMcpTool("baca_insiden", {}, { agentId: "ALL_ACCESS", mode: "file", config: null }, NOW);
    expect(result).toMatchObject({ status: "tidak_tersedia" });
  });

  it.each([
    ["a malformed date", { date: "22-11-2026" }],
    ["a range that ends before it starts", { from: "2026-11-22", to: "2026-11-01" }],
    ["a range longer than 31 days", { from: "2026-10-01", to: "2026-11-22" }],
    ["a limit above 100", { limit: 101 }],
    ["a non-integer limit", { limit: 2.5 }],
  ])("rejects %s before reading anything", async (_label, args) => {
    const { ctx, calls } = context();
    await expect(executeMcpTool("baca_insiden", args, ctx, NOW)).rejects.toThrow(McpToolError);
    expect(calls).toHaveLength(0);
  });
});
