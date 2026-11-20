import { describe, expect, it } from "vitest";
import { boardSummary, bucket, isOverdue, reminderState, type TaskForRules } from "@/lib/tasks/rules";

const task = (over: Partial<TaskForRules> = {}): TaskForRules => ({ status: "dikerjakan", action: "assign", deadline: null, history: [], remindersSent: 0, lastReminderAt: null, lastReplyAt: null, ...over });
const d = (s: string) => new Date(s);

describe("isOverdue", () => {
  const t = task({ deadline: "2026-11-08T00:00" });
  it("compares WIB wall-clock text", () => {
    expect(isOverdue(t, "2026-11-07T23:59")).toBe(false);
    expect(isOverdue(t, "2026-11-08T00:01")).toBe(true);
  });
  it("is false without deadline, for final statuses and for done actions", () => {
    expect(isOverdue(task(), "2030-01-01T00:00")).toBe(false);
    expect(isOverdue(task({ ...t, status: "selesai" }), "2026-11-09T00:00")).toBe(false);
    expect(isOverdue(task({ ...t, status: "ditunda" }), "2026-11-09T00:00")).toBe(false);
    expect(isOverdue(task({ ...t, action: "done" }), "2026-11-09T00:00")).toBe(false);
  });
});

describe("reminderState", () => {
  const fwd = task({ status: "diteruskan", history: [{ status: "dibuat", at: "2026-11-06T07:00:00Z" }, { status: "diteruskan", at: "2026-11-06T08:00:00Z" }] });
  it("waits 24h after the forward", () => {
    expect(reminderState(fwd, d("2026-11-07T07:59:00Z"))).toBe("none");
    expect(reminderState(fwd, d("2026-11-07T08:01:00Z"))).toBe("due");
  });
  it("escalates after two reminders and 24h of silence", () => {
    const t = { ...fwd, remindersSent: 2, lastReminderAt: "2026-11-06T08:00:00Z" };
    expect(reminderState(t, d("2026-11-07T09:00:00Z"))).toBe("escalated");
    expect(reminderState(t, d("2026-11-07T07:00:00Z"))).toBe("none");
  });
  it("measures from the last reminder", () => {
    const t = { ...fwd, remindersSent: 1, lastReminderAt: "2026-11-07T10:00:00Z" };
    expect(reminderState(t, d("2026-11-08T09:00:00Z"))).toBe("none");
    expect(reminderState(t, d("2026-11-08T10:01:00Z"))).toBe("due");
  });
  it("any reply after the last forward/reminder clears it; an older reply does not", () => {
    expect(reminderState({ ...fwd, lastReplyAt: "2026-11-06T09:00:00Z" }, d("2026-11-08T00:00:00Z"))).toBe("none");
    expect(reminderState({ ...fwd, lastReplyAt: "2026-11-06T07:30:00Z" }, d("2026-11-08T00:00:00Z"))).toBe("due");
    const t = { ...fwd, remindersSent: 1, lastReminderAt: "2026-11-07T10:00:00Z", lastReplyAt: "2026-11-07T09:00:00Z" };
    expect(reminderState(t, d("2026-11-09T00:00:00Z"))).toBe("due");
  });
  it("applies only to forwarded statuses and never to done actions", () => {
    expect(reminderState({ ...fwd, status: "dikerjakan" }, d("2026-11-09T00:00:00Z"))).toBe("none");
    expect(reminderState({ ...fwd, action: "done" }, d("2026-11-09T00:00:00Z"))).toBe("none");
    expect(reminderState(task({ status: "diteruskan" }), d("2026-11-09T00:00:00Z"))).toBe("none");
  });
});

describe("bucket", () => {
  const now = d("2026-11-07T00:00:00Z");
  it("archives final tasks older than 7 days", () => {
    expect(bucket(task({ status: "selesai", history: [{ status: "selesai", at: "2026-10-30T00:00:00Z" }] }), now)).toBe("archive");
    expect(bucket(task({ status: "selesai", history: [{ status: "selesai", at: "2026-11-01T00:00:00Z" }] }), now)).toBe("active");
    expect(bucket(task({ status: "dibatalkan", history: [{ status: "dibatalkan", at: "2026-10-01T00:00:00Z" }] }), now)).toBe("archive");
  });
  it("keeps non-final statuses active regardless of age", () => {
    expect(bucket(task({ status: "terkendala", history: [{ status: "terkendala", at: "2026-09-08T00:00:00Z" }] }), now)).toBe("active");
  });
  it("archives done actions at once", () => {
    expect(bucket(task({ action: "done", status: "diteruskan" }), now)).toBe("archive");
  });
});

describe("boardSummary", () => {
  it("counts active open, overdue, kendala and escalated", () => {
    const now = d("2026-11-07T00:00:00Z");
    const tasks = [
      task({ status: "terkendala", deadline: "2026-11-01T00:00" }),
      task({ status: "diteruskan", remindersSent: 2, lastReminderAt: "2026-11-05T00:00:00Z" }),
      task({ status: "selesai", history: [{ status: "selesai", at: "2026-11-06T00:00:00Z" }] }),
      task({ status: "selesai", history: [{ status: "selesai", at: "2026-10-01T00:00:00Z" }] }),
    ];
    expect(boardSummary(tasks, now, "2026-11-07T07:00")).toEqual({ open: 2, overdue: 1, kendala: 1, escalated: 1 });
  });
});

describe("isStale", () => {
  const now = new Date("2026-11-07T10:00:00Z");
  it("is stale beyond 16 hours, fresh within", async () => {
    const { isStale, HEARTBEAT_STALE_MS } = await import("@/lib/tasks/rules");
    expect(HEARTBEAT_STALE_MS).toBe(57_600_000);
    expect(isStale("2026-11-06T17:59:00Z", now)).toBe(true);
    expect(isStale("2026-11-06T18:01:00Z", now)).toBe(false);
    expect(isStale("garbage", now)).toBe(true);
  });
});
