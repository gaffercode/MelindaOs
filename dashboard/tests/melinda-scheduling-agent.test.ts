import { describe, expect, it, vi } from "vitest";
import type { DirectorAuthConfiguration } from "../lib/director/director-auth";
import { MELINDA_SYSTEM_PROMPT } from "../lib/melinda/prompt";
import { MELINDA_TOOLS, runTool } from "../lib/melinda/tools";

function makeContext() {
  const config = {
    appOrigin: "https://melindaos.rsiamelinda.id",
    store: {
      call: vi.fn(async (command: string, args: Record<string, unknown>) => {
        if (command === "board") return { instructions: [] };
        if (command === "create") {
          return {
            instruction: {
              id: "IOC-8801",
              ...args,
              status: "dibuat",
              history: [{ status: "dibuat", at: "2026-11-19T08:30:00Z", actor: "Direktur" }],
              createdAt: "2026-11-19T08:30:00Z",
            },
          };
        }
        if (command === "replace_schedule") return { items: args.items ?? [] };
        if (command === "propose") return { action: { id: "00000000-0000-4000-8000-000000000001", kind: args.kind, summary: args.summary, status: "pending", expiresAt: "2026-11-19T02:15:00Z" } };
        if (command === "submit") return { replayed: false, id: "1", kind: args.kind, date: args.date, payloadHash: "abc", receivedAt: "2026-11-19T08:30:00Z" };
        return {};
      }),
    },
  } as unknown as DirectorAuthConfiguration;

  return { config, now: new Date("2026-11-19T02:00:00Z"), owner: "director-test", conversationId: null };
}

describe("melinda-scheduling-agent", () => {
  it("registers the scheduling tools and no tool that writes without confirmation", () => {
    const names = MELINDA_TOOLS.map((t) => t.name);
    expect(names).toContain("baca_jadwal_struktural");
    expect(names).toContain("baca_task_vault");
    expect(names).toContain("usulkan_status_tugas");
    expect(names).toContain("usulkan_sinkron");
    expect(names).not.toContain("ubah_status_tugas");
    expect(names).not.toContain("sinkronkan_halaman");
  });

  it("reads Thursday baseline schedule with injected Finance/Pharmacy issues via baca_jadwal_struktural", async () => {
    const res = await runTool("baca_jadwal_struktural", { date: "2026-11-19", role: "direktur" }, makeContext());
    expect(res.isError).toBe(false);
    expect(res.text).toContain("tertutup_keuangan_sdm");
    expect(res.text).toContain("ACT-2810-01");
  });

  it("filters Task Vault by domain via baca_task_vault", async () => {
    const res = await runTool("baca_task_vault", { domain: "Keuangan" }, makeContext());
    expect(res.isError).toBe(false);
    expect(res.text).toContain("MLOG-22");
  });

  it("only proposes a task status change via usulkan_status_tugas", async () => {
    const ctx = makeContext();
    const res = await runTool(
      "usulkan_status_tugas",
      {
        task_id: "ACT-2810-01",
        status: "pending_pihak_ketiga",
        pihak_ketiga: "Mitra Contoh",
        catatan: "Menunggu addendum PKS",
      },
      ctx
    );
    expect(res.isError).toBe(false);
    expect(res.text).toContain("menunggu_konfirmasi");
    expect(res.text).toContain("pending_pihak_ketiga");
    const commands = vi.mocked(ctx.config.store.call).mock.calls.map(([command]) => command);
    expect(commands).toContain("propose");
    expect(commands).not.toContain("create");
  });

  it("configures MELINDA_SYSTEM_PROMPT as Staf Khusus Direktur Bidang Penjadwalan with Rule #39", () => {
    expect(MELINDA_SYSTEM_PROMPT).toContain("Staf Khusus");
    expect(MELINDA_SYSTEM_PROMPT).toContain("Rule #39");
    expect(MELINDA_SYSTEM_PROMPT).toContain("usulkan_");
    expect(MELINDA_SYSTEM_PROMPT).toContain("Konfirmasi");
  });
});
