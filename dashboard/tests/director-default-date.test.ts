import { describe, expect, it, vi } from "vitest";
import { emptyDirectorDay } from "@/lib/director/director-data";
import { readDefaultDirectorDay, type DirectorResult } from "@/lib/director/director-repository";

function result(date: string, status: DirectorResult["status"]): DirectorResult {
  return { data: emptyDirectorDay(date), status, message: status === "missing" ? "Belum diterima" : null };
}

describe("default director report date", () => {
  it("reads only today when today has a report", async () => {
    const read = vi.fn(async (date: string) => result(date, "available"));
    const selected = await readDefaultDirectorDay("2026-10-06", read);
    expect(read).toHaveBeenCalledOnce();
    expect(selected.data.date).toBe("2026-10-06");
  });

  it("opens the most recent received report without requiring review", async () => {
    const read = vi.fn(async (date: string) => date === "2026-10-05" ? {
      ...result(date, "available"),
      submission: { revisionId: "received", payloadHash: "1".repeat(64), receivedAt: "2026-10-05T07:03:00+07:00", reviewStatus: "pending" as const },
    } : result(date, "missing"));

    const selected = await readDefaultDirectorDay("2026-10-06", read);

    expect(read.mock.calls.map(([date]) => date)).toEqual(["2026-10-06", "2026-10-05", "2026-10-04", "2026-10-03", "2026-10-02", "2026-10-01", "2026-09-30"]);
    expect(selected.data.date).toBe("2026-10-05");
    expect(selected.submission?.reviewStatus).toBe("pending");
  });

  it("starts all older reads before any of them resolves", async () => {
    let started = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const read = vi.fn(async (date: string) => {
      started += 1;
      if (date === "2026-10-06") return result(date, "missing");
      await gate;
      return date === "2026-10-04" || date === "2026-10-02" ? result(date, "available") : result(date, "missing");
    });

    const pending = readDefaultDirectorDay("2026-10-06", read);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(started).toBe(7);
    release();
    expect((await pending).data.date).toBe("2026-10-04");
  });

  it("prefers the newest non-missing day even when an older day resolves first", async () => {
    const read = vi.fn(async (date: string) => {
      if (date === "2026-10-04") return result(date, "available");
      if (date === "2026-10-05") { await new Promise((resolve) => setTimeout(resolve, 5)); return result(date, "available"); }
      return result(date, "missing");
    });
    expect((await readDefaultDirectorDay("2026-10-06", read)).data.date).toBe("2026-10-05");
  });

  it("does not hide a source or validation failure behind an older report", async () => {
    const read = vi.fn(async (date: string) => date === "2026-10-06" ? result(date, "invalid") : result(date, "available"));
    const selected = await readDefaultDirectorDay("2026-10-06", read);
    expect(read).toHaveBeenCalledOnce();
    expect(selected.status).toBe("invalid");
    expect(selected.data.date).toBe("2026-10-06");
  });

  it("stops after the bounded seven-day lookup when no report exists", async () => {
    const read = vi.fn(async (date: string) => result(date, "missing"));
    const selected = await readDefaultDirectorDay("2026-10-06", read);
    expect(read).toHaveBeenCalledTimes(7);
    expect(selected.data.date).toBe("2026-10-06");
  });

  it("crosses month boundaries", async () => {
    const read = vi.fn(async (date: string) => result(date, "missing"));
    await readDefaultDirectorDay("2026-03-01", read);
    expect(read.mock.calls.at(-1)?.[0]).toBe("2026-02-23");
  });

  it("passes an invalid date straight to the reader", async () => {
    const read = vi.fn(async () => result("2026-10-06", "missing"));
    const selected = await readDefaultDirectorDay("2026-13-99", read);
    expect(read).toHaveBeenCalledOnce();
    expect(selected.status).toBe("missing");
  });
});
