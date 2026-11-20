import { describe, expect, it } from "vitest";
import { buildOfficePlan, parseExecutiveCommand, readinessItems } from "@/lib/executive/executive-office";

const base = {
  command: "calendar_upsert", owner: "director", kind: "meeting", eventId: "dir-123",
  meetingId: "joint-123", sourceUpdatedAt: "2026-11-08T10:00:00+07:00",
  startAt: "2026-11-09T10:00:00+07:00", endAt: "2026-11-09T11:00:00+07:00",
  title: "Rapat keuangan", place: "Ruang direksi", participants: ["Bu Yuni"],
  department: "Keuangan", visibility: "normal", status: "confirmed", sharedWithNovia: true,
};
const event = (owner: "director" | "novia", meetingId: string, startAt: string, endAt: string) => ({
  owner, kind: "meeting" as const, eventId: owner + meetingId, meetingId,
  startAt, endAt, title: owner === "novia" ? "Sibuk" : "Rapat keuangan",
  status: "confirmed", visibility: owner === "novia" ? "busy" : "normal",
  sharedWithNovia: owner === "director", department: owner === "director" ? "Keuangan" : null,
});
describe("Executive office calendar guardrails", () => {
  it("accepts a complete scheduled meeting", () => {
    expect(parseExecutiveCommand(base)).toMatchObject({ owner: "director", kind: "meeting", meetingId: "joint-123" });
  });
  it("only exposes busy/free for a private Novia event", () => {
    expect(parseExecutiveCommand({ ...base, owner: "novia", eventId: "novia-2", visibility: "busy" }))
      .toMatchObject({ title: "Sibuk", place: null, department: null, participants: [] });
  });
  it("rejects ambiguous calendar revisions, bad time intervals and unknown fields", () => {
    expect(() => parseExecutiveCommand({ ...base, sourceUpdatedAt: "2026-11-08T10:00:00" })).toThrow();
    expect(() => parseExecutiveCommand({ ...base, endAt: base.startAt })).toThrow();
    expect(() => parseExecutiveCommand({ ...base, title: "x", secret: "token" })).toThrow();
  });
  it("only accepts checklist updates with evidence and message id", () => {
    expect(parseExecutiveCommand({ command: "readiness_update", meetingId: "joint-123", item: "room",
      state: "ready", evidence: "Ruang dan fasilitas telah diperiksa asisten", messageId: "wa-123" }))
      .toMatchObject({ item: "room", state: "ready" });
    expect(() => parseExecutiveCommand({ command: "readiness_update", meetingId: "joint-123",
      item: "room", state: "ready", evidence: "", messageId: "wa-123" })).toThrow();
  });
  it("requires external delivery evidence and a secure minutes URL", () => {
    expect(parseExecutiveCommand({ command: "delivery_ack", key: "exec:1:assistant", state: "sent",
      messageId: "wa-1", note: null })).toMatchObject({ state: "sent" });
    expect(() => parseExecutiveCommand({ command: "meeting_close", meetingId: "joint-123",
      outcome: "Disetujui", minutesUrl: "http://unsafe.example/notulen", messageId: "wa-2" })).toThrow();
  });
});
describe("Meeting readiness and calendar reconciliation", () => {
  const start = "2026-11-09T10:00:00+07:00", end = "2026-11-09T11:00:00+07:00";
  it("does not call a shared meeting ready before Novia's calendar is synchronized", () => {
    const plan = buildOfficePlan([event("director", "joint-123", start, end)], []);
    expect(plan[0]).toMatchObject({ synchronized: false, conflict: false, readiness: "partial" });
    expect(plan[0].checklist).toHaveLength(7);
  });
  it("only marks ready after both calendars match and every checklist item is evidenced", () => {
    const updates = readinessItems.map((item) => ({ meetingId: "joint-123", item,
      state: "ready" as const, evidence: "Sudah disiapkan", recordedAt: "2026-11-09T02:00:00Z" }));
    const plan = buildOfficePlan([event("director", "joint-123", start, end), event("novia", "joint-123", start, end)], updates);
    expect(plan[0]).toMatchObject({ synchronized: true, conflict: false, readiness: "ready" });
  });
  it("blocks overlapping Novia events and explicit readiness blockers", () => {
    const events = [event("director", "joint-123", start, end),
      event("novia", "joint-123", start, end),
      event("novia", "separate", "2026-11-09T10:30:00+07:00", "2026-11-09T11:30:00+07:00")];
    expect(buildOfficePlan(events, [])[0]).toMatchObject({ conflict: true, readiness: "blocked" });
    expect(buildOfficePlan(events.slice(0, 2), [{ meetingId: "joint-123", item: "attendees", state: "blocked",
      evidence: "Konfirmasi belum masuk", recordedAt: "2026-11-09T02:00:00Z" }])[0].readiness).toBe("blocked");
  });
  it("does not turn calendar busy blocks into assistant preparation tasks", () => {
    expect(buildOfficePlan([event("novia", "private", start, end)], [])).toHaveLength(0);
  });
});
