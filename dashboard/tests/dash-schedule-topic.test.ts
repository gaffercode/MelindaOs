import { describe, expect, it } from "vitest";
import { parseScheduleSubmission } from "@/lib/tasks/contract";
import { dashScheduleToBriefEntries } from "@/lib/dash-schedule-entries";
import type { ScheduleRow } from "@/lib/tasks/store";

const row = (over: Partial<ScheduleRow> & { id: string }): ScheduleRow => ({
  date: "2026-11-09",
  position: 0,
  start: "10:00",
  end: "10:15",
  title: "Butir sintetis",
  place: "Ruang sintetis",
  pic: ["Sinta"],
  topic: null,
  producer: "dash",
  createdAt: "2026-11-09T00:00:00Z",
  taskIds: [],
  ...over,
});

describe("dash schedule topic contract", () => {
  it("keeps old producers valid: a missing topic parses to null", () => {
    const parsed = parseScheduleSubmission({
      date: "2026-11-09",
      items: [{ start: "09:00", end: "09:15", title: "Butir lama", place: null, pic: ["Direktur"] }],
    });
    expect(parsed.items).toEqual([
      { start: "09:00", end: "09:15", title: "Butir lama", place: null, pic: ["Direktur"], topic: null },
    ]);
  });

  it("accepts a 288-character topic (the longest canonical 2026-11-09 follow-up)", () => {
    const parsed = parseScheduleSubmission({
      date: "2026-11-09",
      items: [{ start: "16:15", end: "17:15", title: "Butir", place: null, pic: [], topic: "t".repeat(288) }],
    });
    expect(parsed.items[0].topic).toHaveLength(288);
  });

  it("rejects a topic over 300 characters and an unknown topic key", () => {
    const base = { start: "09:00", end: null, title: "Butir", place: null, pic: [] as string[] };
    expect(() =>
      parseScheduleSubmission({ date: "2026-11-09", items: [{ ...base, topic: "t".repeat(301) }] }),
    ).toThrow();
    expect(() =>
      parseScheduleSubmission({ date: "2026-11-09", items: [{ ...base, topic: "ok", followup: "x" }] }),
    ).toThrow();
  });
});

describe("dash schedule topic display", () => {
  it("renders topic in the follow-up cell and never copies place into it", () => {
    const [entry] = dashScheduleToBriefEntries([
      row({ id: "t1", topic: "Bahan tindak lanjut sintetis." }),
    ]);
    expect(entry.topikTindakLanjut).toBe("Bahan tindak lanjut sintetis.");
  });

  it("renders an empty cell for rows without a topic, including legacy rows", () => {
    const [withoutTopic, legacy] = dashScheduleToBriefEntries([
      row({ id: "t2", place: "Ruang sintetis", topic: null }),
      { ...row({ id: "t3", place: "Ruang sintetis" }), topic: undefined } as unknown as ScheduleRow,
    ]);
    expect(withoutTopic.topikTindakLanjut).toBe("");
    expect(legacy.topikTindakLanjut).toBe("");
  });
});
