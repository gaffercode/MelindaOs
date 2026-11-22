import { describe, expect, it } from "vitest";
import { buildBaselineSchedule } from "@/lib/work-schedule/baseline-schedule";
import { buildEnrichedScheduleForRole, buildFallbackBoardSchedule, buildFallbackOfficePlan } from "@/lib/work-schedule/fallbacks";
import { composeNewsEdition } from "@/lib/news/news-composer";
import { applyOverrides, parseScheduleChange, ScheduleChangeError, type ScheduleOverride } from "@/lib/work-schedule/schedule-overrides";

const date = "2026-11-19";
const override = (change: Partial<ScheduleOverride>, createdAt: string): ScheduleOverride => ({
  id: createdAt.slice(-3, -1), date, role: "direktur", kind: "add", slotId: null, start: null, end: null, title: null, place: null, note: "", createdAt, ...change,
});

describe("schedule overrides", () => {
  const baseline = buildBaselineSchedule(date, "direktur");

  it("adds, moves and cancels meetings in creation order and keeps time order", () => {
    const [first, second] = baseline;
    const result = applyOverrides(baseline, [
      override({ kind: "move", slotId: first.id, start: "21:00" }, "2026-11-19T01:00:02Z"),
      override({ kind: "add", start: "06:00", end: "06:30", title: "Telepon yayasan" }, "2026-11-19T01:00:01Z"),
      override({ kind: "cancel", slotId: second.id }, "2026-11-19T01:00:03Z"),
    ]);
    expect(result[0]).toMatchObject({ title: "Telepon yayasan", timeRange: "06:00 - 06:30", id: "ovr-01" });
    expect(result.some((slot) => slot.id === second.id)).toBe(false);
    expect(result.at(-1)).toMatchObject({ id: first.id, startTime: "21:00" });
    expect(result.map((slot) => slot.startTime)).toEqual([...result.map((slot) => slot.startTime)].sort());
  });

  it("applies only the role's own overrides when building a role's day", () => {
    const other = override({ role: "wadir_ops", kind: "cancel", slotId: baseline[0].id }, "2026-11-19T01:00:01Z");
    expect(buildEnrichedScheduleForRole(date, "direktur", [], [other]).slots.map((slot) => slot.id)).toContain(baseline[0].id);
  });

  it("applies the Director's overrides in the fallback schedule, the office plan and Warta", () => {
    const cancelled = baseline.find((slot) => slot.category === "Meeting")!;
    const cancel = override({ kind: "cancel", slotId: cancelled.id }, "2026-11-19T01:00:01Z");
    expect(buildFallbackBoardSchedule(date, [], [cancel]).map((row) => row.id)).not.toContain(cancelled.id);
    expect(buildFallbackOfficePlan(date, [], [cancel]).events.map((event) => event.title)).not.toContain(cancelled.title);
    // Warta highlights one meeting of the day; cancelling it moves the highlight elsewhere.
    const highlighted = baseline.find((slot) => slot.forumId.startsWith("tertutup_") || slot.forumId === "sync_layanan_klaim") ?? baseline.find((slot) => slot.forumId === "lead_brief")!;
    const deck = (overrides: ScheduleOverride[]) => composeNewsEdition({ date, snapshot: null, instructions: [], overrides }).edition.lead?.deck;
    expect(deck([])).toContain(highlighted.title.slice(0, 20));
    expect(deck([])).not.toBe(deck([override({ kind: "cancel", slotId: highlighted.id }, "2026-11-19T01:00:01Z")]));
  });

  it("checks the model's input", () => {
    expect(parseScheduleChange({ jenis: "tambah", mulai: "09:00", judul: "Rapat" }, date)).toMatchObject({ kind: "add", role: "direktur", date, slotId: null });
    expect(() => parseScheduleChange({ jenis: "pindah", mulai: "09:00" }, date)).toThrow(ScheduleChangeError);
    expect(() => parseScheduleChange({ jenis: "tambah", judul: "Rapat" }, date)).toThrow(ScheduleChangeError);
    expect(() => parseScheduleChange({ jenis: "tambah", mulai: "10:00", selesai: "09:00", judul: "Mundur" }, date)).toThrow(ScheduleChangeError);
    expect(() => parseScheduleChange({ jenis: "batal", slot_id: "x", jabatan: "bupati" }, date)).toThrow(ScheduleChangeError);
  });
});
