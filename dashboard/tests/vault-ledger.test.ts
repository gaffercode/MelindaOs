import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DirectorAuthConfiguration } from "@/lib/director/director-auth";
import { vaultLedger, type BoardInstruction } from "@/lib/tasks/store";

const row = (id: string) => ({ id, itemId: id, note: "[STATUS:selesai]" }) as unknown as BoardInstruction;
let archiveCalls: Record<string, unknown>[];
let archiveFails: boolean;

const store = {
  call: vi.fn(async (command: string, args: Record<string, unknown>) => {
    if (command === "board") return { instructions: [row("OPEN-1")] };
    archiveCalls.push(args);
    if (archiveFails) throw new Error("archive down");
    const offset = Number(args.offset);
    // Five full pages exist; the ledger must stop after four.
    return { instructions: Array.from({ length: 50 }, (_, index) => row(`DONE-${offset + index}`)), offset, pageSize: 50, hasMore: true };
  }),
};
const config = { store } as unknown as DirectorAuthConfiguration;

beforeEach(() => {
  archiveCalls = []; archiveFails = false;
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("vaultLedger", () => {
  it("adds archived rows tagged with a vault status to the board, at most four pages", async () => {
    const rows = await vaultLedger(config, { now: "2026-11-22T02:00:00Z" });
    expect(rows[0].id).toBe("OPEN-1");
    expect(rows).toHaveLength(201);
    expect(archiveCalls.map((args) => args.offset)).toEqual([0, 50, 100, 150]);
    expect(archiveCalls.every((args) => args.q === "[STATUS:" && args.now === "2026-11-22T02:00:00Z")).toBe(true);
  });

  it("falls back to the board when the archive cannot be read", async () => {
    archiveFails = true;
    expect((await vaultLedger(config, { now: "2026-11-22T02:00:00Z" })).map((item) => item.id)).toEqual(["OPEN-1"]);
  });
});
