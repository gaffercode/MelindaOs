import { mkdtemp, rm, writeFile, symlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { emptyDirectorDay, parseDirectorDay, wibDate, wibTime, validReportDate } from "@/lib/director/director-data";
import { readDirectorDay } from "@/lib/director/director-repository";

const folders: string[] = [];
afterEach(async () => { await Promise.all(folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true }))); });
async function directory() { const folder = await mkdtemp(join(tmpdir(), "melinda-director-test-")); folders.push(folder); return folder; }

describe("director daily data boundary", () => {
  it("uses the WIB date at UTC midnight crossing and 24-hour colon times", () => {
    expect(wibDate(new Date("2026-10-02T18:00:00Z"))).toBe("2026-10-03");
    expect(wibTime("2026-10-02T18:05:00Z")).toBe("01:05 WIB");
    expect(wibTime("2026-10-03T17:00:00Z")).toBe("00:00 WIB");
  });
  it.each(["2026-02-30", "../2026-10-03", "2026-1-3", "constructor", "2026-13-01"])("rejects unsafe or impossible date %s", (date) => {
    expect(validReportDate(date)).toBe(false);
  });
  it("keeps unavailable aggregates null rather than inventing zero hospital activity", () => {
    const report = emptyDirectorDay("2026-10-03");
    expect(parseDirectorDay(report, "2026-10-03")).toEqual(report);
    expect(report.dailyReport.visits).toBeNull();
    expect(report.schedule.updatedAt).toBeNull();
  });
  it("accepts empty v2 reports while preserving the six required sections", () => {
    const day = { ...emptyDirectorDay("2026-10-03"), schemaVersion: 2 };
    expect(parseDirectorDay(day, day.date)).toEqual(day);
    expect(() => parseDirectorDay({ ...day, schedule: null }, day.date)).toThrow();
  });
  it("rejects extra fields, mismatched dates and invalid clinical aggregate values", () => {
    const report = emptyDirectorDay("2026-10-03");
    expect(() => parseDirectorDay({ ...report, patients: [{ name: "Data sintetis" }] }, "2026-10-03")).toThrow();
    expect(() => parseDirectorDay(report, "2026-10-04")).toThrow();
    expect(() => parseDirectorDay({ ...report, dailyReport: { ...report.dailyReport, visits: -1 } }, "2026-10-03")).toThrow();
    expect(() => parseDirectorDay({ ...report, dailyReport: { ...report.dailyReport, bpjsPending: 1.5 } }, "2026-10-03")).toThrow();
  });
  it("requires source timestamps and ordered time range endpoints for populated agenda", () => {
    const report = emptyDirectorDay("2026-10-03");
    const item = { id: "agenda-1", start: "08:00", end: "09:00", title: "Rapat sintetis", note: "" };
    expect(() => parseDirectorDay({ ...report, schedule: { ...report.schedule, items: [item] } }, report.date)).toThrow();
    const schedule = { updatedAt: "2026-10-03T07:00:00+07:00", source: "Fixture uji", items: [item] };
    expect(parseDirectorDay({ ...report, schedule }, report.date).schedule.items[0].start).toBe("08:00");
    expect(() => parseDirectorDay({ ...report, schedule: { ...schedule, items: [{ ...item, end: "07:59" }] } }, report.date)).toThrow();
    expect(() => parseDirectorDay({ ...report, schedule: { ...schedule, updatedAt: "2026-02-30T07:00:00+07:00" } }, report.date)).toThrow();
    expect(() => parseDirectorDay({ ...report, schedule: { ...schedule, items: [item, item] } }, report.date)).toThrow();
  });
  it("rereads changed daily files without cached or stale fallback data", async () => {
    const folder = await directory();
    const path = join(folder, "2026-10-03.json");
    const report = emptyDirectorDay("2026-10-03");
    expect((await readDirectorDay(report.date, folder)).status).toBe("missing");
    await writeFile(path, JSON.stringify(report));
    expect((await readDirectorDay(report.date, folder)).status).toBe("available");
    const changed = { ...report, dailyReport: { ...report.dailyReport, updatedAt: "2026-10-03T08:00:00+07:00", source: "Fixture uji", visits: 23 } };
    await writeFile(path, JSON.stringify(changed));
    expect((await readDirectorDay(report.date, folder)).data.dailyReport.visits).toBe(23);
    await writeFile(path, "{");
    const result = await readDirectorDay(report.date, folder);
    expect(result.status).toBe("invalid");
    expect(result.data.dailyReport.visits).toBeNull();
    expect(result.message).not.toContain(folder);
  });
  it("rejects file symlinks outside the configured data directory", async () => {
    const folder = await directory();
    const outside = await directory();
    const target = join(outside, "2026-10-03.json");
    await writeFile(target, JSON.stringify(emptyDirectorDay("2026-10-03")));
    await symlink(target, join(folder, "2026-10-03.json"), "file");
    expect((await readDirectorDay("2026-10-03", folder)).status).toBe("invalid");
  });
  it("warns about future source timestamps and rejects oversized daily files", async () => {
    const folder = await directory();
    const path = join(folder, "2026-10-03.json");
    const day = emptyDirectorDay("2026-10-03");
    day.schedule.updatedAt = "2099-10-03T08:00:00+07:00";
    await writeFile(path, JSON.stringify(day));
    expect((await readDirectorDay(day.date, folder)).message).toContain("masa depan");
    await writeFile(path, " ".repeat(256_001));
    expect((await readDirectorDay(day.date, folder)).status).toBe("invalid");
  });
});
