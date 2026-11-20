import { describe, expect, it } from "vitest";
import { parseScheduleSubmission, parseStaffReply } from "@/lib/tasks/contract";

const reply = { kattMessageId: "wa:ABC-1.x", receivedAt: "2026-11-07T08:00:00Z", fromName: "Siti", originalText: "Sudah kami kerjakan", attachments: [], summary: null, needs: null, classifiedStatus: "dikerjakan", confidence: 0.9 };
const sched = { date: "2026-11-08", items: [{ start: "08:00", end: null, title: "Rapat", place: null, pic: ["Siti"] }] };

describe("parseStaffReply", () => {
  it("accepts a valid reply", () => expect(parseStaffReply(reply)).toMatchObject({ kattMessageId: "wa:ABC-1.x", confidence: 0.9, attachments: [] }));
  it("requires a summary for terkendala", () => {
    expect(() => parseStaffReply({ ...reply, classifiedStatus: "terkendala" })).toThrow();
    expect(() => parseStaffReply({ ...reply, classifiedStatus: "terkendala", summary: "  " })).toThrow();
    expect(parseStaffReply({ ...reply, classifiedStatus: "terkendala", summary: "Alat rusak" }).summary).toBe("Alat rusak");
  });
  it("limits attachments to 10 https urls", () => {
    const a = (n: number) => Array.from({ length: n }, (_, i) => ({ url: `https://x.test/${i}`, mime: "image/jpeg" }));
    expect(parseStaffReply({ ...reply, attachments: a(10) }).attachments).toHaveLength(10);
    expect(() => parseStaffReply({ ...reply, attachments: a(11) })).toThrow();
    expect(() => parseStaffReply({ ...reply, attachments: [{ url: "http://x.test/a", mime: "image/jpeg" }] })).toThrow();
  });
  it("rejects bad fields and unknown keys", () => {
    for (const bad of [{ extra: 1 }, { kattMessageId: "a b" }, { kattMessageId: "" }, { receivedAt: "yesterday" }, { fromName: "" }, { originalText: "" }, { originalText: "x".repeat(4001) },
      { summary: "x".repeat(401) }, { needs: "x".repeat(281) }, { confidence: 1.1 }, { confidence: -0.1 }, { classifiedStatus: "ditunda" }]) {
      expect(() => parseStaffReply({ ...reply, ...bad })).toThrow();
    }
    expect(() => parseStaffReply(null)).toThrow();
  });
});

describe("parseScheduleSubmission", () => {
  it("accepts a valid schedule without a topic (old producers stay valid)", () => expect(parseScheduleSubmission(sched)).toEqual({ ...sched, items: [{ ...sched.items[0], topic: null }] }));
  it("accepts a valid schedule with a topic", () => {
    const withTopic = { ...sched, items: [{ ...sched.items[0], topic: "Bahan tindak lanjut." }] };
    expect(parseScheduleSubmission(withTopic)).toEqual(withTopic);
  });
  it("accepts boundary limits", () => {
    const item = sched.items[0];
    const r = parseScheduleSubmission({ ...sched, items: [{ ...item, place: "p".repeat(120), pic: Array(8).fill("a".repeat(60)), topic: "t".repeat(300) }] });
    expect(r.items[0].place).toHaveLength(120);
    expect(r.items[0].pic).toHaveLength(8);
    expect(r.items[0].topic).toHaveLength(300);
  });
  it("rejects invalid input", () => {
    const item = sched.items[0];
    for (const bad of [{ date: "2026-02-30" }, { items: [] }, { items: Array(41).fill(item) }, { items: [{ ...item, start: "8:00" }] }, { items: [{ ...item, start: "24:00" }] },
      { items: [{ ...item, title: "" }] }, { items: [{ ...item, pic: Array(9).fill("a") }] }, { items: [{ ...item, pic: ["a".repeat(61)] }] }, { items: [{ ...item, place: "p".repeat(121) }] }, { items: [{ ...item, pic: [""] }] }, { items: [{ ...item, topic: "t".repeat(301) }] }, { items: [{ ...item, extra: 1 }] }, { items: [{ ...item, topic: 1 }] }, { extra: 1 }]) {
      expect(() => parseScheduleSubmission({ ...sched, ...bad })).toThrow();
    }
  });
});
