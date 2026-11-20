import { describe, expect, it, vi } from "vitest";
import type { DirectorAuthConfiguration } from "../lib/director/director-auth";
import {
  buildFallbackBoardSchedule,
  buildFallbackOfficePlan,
  submitVaultTaskFeedback,
  syncTodayAllPages,
} from "../lib/work-schedule/sync-and-feedback";

function makeMockConfig() {
  const calls: { rpc: string; command: string; args: Record<string, unknown> }[] = [];
  const config: DirectorAuthConfiguration = {
    appOrigin: "https://melindaos.rsiamelinda.id",
    store: {
      call: vi.fn(async (command: string, args: Record<string, unknown>, rpc = "melinda_director_instructions") => {
        calls.push({ rpc, command, args });
        if (command === "board") {
          return { instructions: [] };
        }
        if (command === "create") {
          return {
            instruction: {
              id: "IOC-7701",
              ...args,
              status: "dibuat",
              history: [{ status: "dibuat", at: new Date().toISOString(), actor: args.reviewerId ?? "Direktur" }],
              createdAt: new Date().toISOString(),
            },
          };
        }
        if (command === "replace_schedule") {
          return { items: args.items ?? [] };
        }
        if (command === "submit") {
          return {
            replayed: false,
            id: "00000000-0000-4000-8000-000000000001",
            kind: args.kind,
            date: args.date,
            payloadHash: "abc",
            receivedAt: new Date().toISOString(),
          };
        }
        return {};
      }),
    },
  } as unknown as DirectorAuthConfiguration;

  return { config, calls };
}

describe("work-schedule-api & sync-and-feedback", () => {
  it("enforces Rule #39 when operational staff submits status 'selesai'", async () => {
    const { config } = makeMockConfig();
    const res = await submitVaultTaskFeedback(config, {
      date: "2026-11-19",
      taskId: "ACT-2610-01",
      status: "selesai",
      note: "Sudah bersih dan terpasang",
      actorRole: "STRUCTURAL",
      actorLabel: "Ibu Oriza (Kabag Umum)",
    });

    expect(res.resolvedStatus).toBe("menunggu_verifikasi_novia");
    expect(res.rule39Applied).toBe(true);
    expect(res.instructionId).toBe("IOC-7701");
  });

  it("allows Director/Vice Director to close a task as 'selesai'", async () => {
    const { config } = makeMockConfig();
    const res = await submitVaultTaskFeedback(config, {
      date: "2026-11-19",
      taskId: "ACT-2610-01",
      status: "selesai",
      note: "Diverifikasi langsung saat visite",
      actorRole: "VICE_DIRECTOR",
      actorLabel: "dr. Novia (Wadir Operasional)",
    });

    expect(res.resolvedStatus).toBe("selesai");
    expect(res.rule39Applied).toBe(false);
  });

  it("syncTodayAllPages seeds schedule, composes brief & news edition, and returns counts", async () => {
    const { config } = makeMockConfig();
    const result = await syncTodayAllPages(config, "2026-11-19");

    expect(result.date).toBe("2026-11-19");
    expect(result.scheduleCount).toBeGreaterThanOrEqual(8);
    expect(result.openTasksCount).toBeGreaterThanOrEqual(20);
    expect(result.briefComposed).toBe(true);
    expect(result.newsComposed).toBe(true);
  });

  it("builds non-empty fallback schedule and executive office readiness for /arahan and /arahan/persiapan", () => {
    const schedule = buildFallbackBoardSchedule("2026-11-19", []);
    expect(schedule.length).toBeGreaterThanOrEqual(8);
    expect(schedule.some((s) => s.title.toLowerCase().includes("keuangan"))).toBe(true);

    const office = buildFallbackOfficePlan("2026-11-19", []);
    expect(office.events.length).toBeGreaterThanOrEqual(3);
    expect(office.readiness.length).toBeGreaterThanOrEqual(3);
  });
});
