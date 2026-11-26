import { describe, expect, it } from "vitest";
import type { McpAuthContext, McpAuthMode } from "@/lib/mcp/auth";
import { executeMcpTool } from "@/lib/mcp/tools";
import { VAULT_TASKS } from "@/lib/work-schedule/task-vault";

const ctx = (mode: McpAuthMode): McpAuthContext => ({ agentId: "ALL_ACCESS", mode, credential: mode === "director_session" ? "director" : "shared", config: null });
const close = async (mode: McpAuthMode) =>
  ((await executeMcpTool("ubah_status_tugas", { task_id: VAULT_TASKS[0].id, status: "selesai", bypass_rule39: true }, ctx(mode))) as { resolvedStatus: string }).resolvedStatus;

describe("Rule #39 bypass over MCP", () => {
  it("is honoured only in the Director's own session", async () => {
    expect(await close("director_session")).toBe("selesai");
    expect(await close("master_token")).toBe("menunggu_verifikasi_novia");
    expect(await close("file")).toBe("menunggu_verifikasi_novia");
  });
});
