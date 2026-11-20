import { describe, expect, it, vi } from "vitest";
import type { DirectorAuthConfiguration } from "@/lib/director/director-auth";
import { buildBriefing, readBriefing, type BriefingInput, type ExecutiveMeeting } from "@/lib/melinda/briefing";
import type { MedifySnapshotResult } from "@/lib/medify/medify-snapshot-store";
import type { OrderFile, OrderFileList } from "@/lib/pharmacy/order-obat-api";
import type { BoardInstruction, ScheduleRow } from "@/lib/tasks/store";
import { DirectorStoreError } from "@/lib/director/director-store";

vi.mock("@/lib/pdf-text", () => ({ extractPdfTextRows: async () => { throw new Error("worker missing"); } }));

const now = new Date("2026-11-09T01:00:00Z"); // 08.00 WIB
const missingMedify = { status: "missing", snapshot: null, receivedAt: null, checkedAt: now.toISOString(), message: "Belum ada" } as MedifySnapshotResult;
const noOrders: OrderFileList = { orders: [], decisions: {}, uploads: false, storeNotice: null };
const emptyInput: BriefingInput = { schedule: [], meetings: [], tasks: [], orders: noOrders, pendingReviews: 0, medify: missingMedify };

const row = (start: string, title: string, end: string | null = null) => ({ id: title, date: "2026-11-09", position: 1, start, end, title, place: null, pic: [], topic: null, producer: "dash", createdAt: "", taskIds: [] }) as ScheduleRow;
const meeting = (startAt: string, extra: Partial<ExecutiveMeeting> = {}) => ({ title: "Rapat direksi", startAt, endAt: new Date(Date.parse(startAt) + 1_800_000).toISOString(), conflict: false, readiness: "ready", department: null, ...extra }) as ExecutiveMeeting;
const task = (id: string, extra: Partial<BoardInstruction> = {}) => ({ id, itemTitle: `Tugas ${id}`, note: "Catatan", status: "dikerjakan", action: "assign", deadline: "2026-11-10T08:00", history: [], remindersSent: 0, lastReminderAt: null, latestReply: null, ...extra }) as BoardInstruction;
const order = (key: string) => ({ key, fileName: `${key}.pdf` }) as OrderFile;
const medifyWithBor = (bor: number) => ({ status: "current", snapshot: { inpatient: { daily: [{ date: "2026-11-09", bor }] } }, receivedAt: "", checkedAt: "", message: null }) as unknown as MedifySnapshotResult;

describe("buildBriefing", () => {
  it("greets with the WIB date and time", () => {
    const briefing = buildBriefing(emptyInput, now);
    expect(briefing.greeting).toBe("Selamat datang, Pak Direktur");
    expect(briefing.timeLabel).toBe("08.00 WIB");
    expect(briefing.dateLabel).toContain("November 2026");
  });

  it("tells an empty day apart from a failed source", () => {
    expect(buildBriefing(emptyInput, now).schedule).toEqual({ state: "ok", items: [] });
    expect(buildBriefing({ ...emptyInput, schedule: null, meetings: null }, now).schedule).toEqual({ state: "unavailable", message: "Data jadwal belum tersedia." });
  });

  it("never calls a day empty when one schedule source failed, and names which one", () => {
    expect(buildBriefing({ ...emptyInput, schedule: null, meetings: [] }, now).schedule).toEqual({ state: "ok", items: [], note: "Jadwal Dash belum tersedia." });
    const officeDown = buildBriefing({ ...emptyInput, schedule: [row("10:00", "Rapat komite")], meetings: null }, now).schedule;
    expect(officeDown).toMatchObject({ state: "ok", note: "Rapat kantor belum tersedia." });
    expect(JSON.stringify(officeDown)).toContain("Rapat komite");
  });

  it("merges Dash and office items by start time and flags a blocked meeting", () => {
    const briefing = buildBriefing({ ...emptyInput, schedule: [row("10:00", "Rapat komite")], meetings: [meeting("2026-11-09T01:30:00Z", { readiness: "blocked" })] }, now);
    expect(briefing.schedule).toMatchObject({ state: "ok", items: [{ start: "08.30", flag: "belum siap" }, { start: "10.00", flag: null }] });
  });

  it("flags overlapping items as bentrok, and shows one entry when Dash and the office list the same meeting", () => {
    const overlap = buildBriefing({ ...emptyInput, schedule: [row("09:00", "Visite", "10:00"), row("09:30", "Komite", "10:30")] }, now);
    expect(overlap.schedule).toMatchObject({ state: "ok", items: [{ flag: "bentrok" }, { flag: "bentrok" }] });
    const same = buildBriefing({ ...emptyInput, schedule: [row("08:30", "Rapat direksi", "09:00")], meetings: [meeting("2026-11-09T01:30:00Z")] }, now);
    expect(same.schedule).toMatchObject({ state: "ok", items: [{ title: "Rapat direksi", flag: null }] });
  });

  it("counts overdue tasks and lists at most three urgent ones, overdue first", () => {
    const tasks = [task("soon", { deadline: "2026-11-09T12:00" }), task("kendala", { status: "terkendala" }), task("later"), task("overdue-1", { deadline: "2026-11-08T08:00" })];
    const briefing = buildBriefing({ ...emptyInput, tasks }, now);
    expect(briefing.tasks).toMatchObject({ state: "ok", overdue: 1 });
    if (briefing.tasks.state !== "ok") throw new Error("expected ok");
    expect(briefing.tasks.urgent.map((item) => item.id)).toEqual(["overdue-1", "kendala", "soon"]);
  });

  it("leaves finished tasks out of the urgent list", () => {
    const briefing = buildBriefing({ ...emptyInput, tasks: [task("selesai-1", { status: "selesai", deadline: "2026-11-09T09:00" })] }, now);
    expect(briefing.tasks).toMatchObject({ state: "ok", waiting: 0, overdue: 0, urgent: [] });
  });

  it("names undecided order files, pending reviews and BOR above 85", () => {
    const orders: OrderFileList = { ...noOrders, orders: [order("a"), order("b")], decisions: { a: { orderKey: "a", decision: "diterima", note: null, decidedBy: "x", decidedAt: "" } } };
    const briefing = buildBriefing({ ...emptyInput, orders, pendingReviews: 2, medify: medifyWithBor(91.2) }, now);
    expect(briefing.attention).toMatchObject({ state: "ok" });
    if (briefing.attention.state !== "ok") throw new Error("expected ok");
    expect(briefing.attention.items.map((item) => item.href)).toEqual(["/order-obat", "/director-review?tanggal=2026-11-09", "/#section-00"]);
    expect(briefing.attention.items[0].text).toContain("1 berkas order obat");
    expect(briefing.attention.items[2].text).toContain("91,2%");
  });

  it("flags a previous-day Medify snapshot", () => {
    const previous = { status: "previous", sourceDate: "2026-11-08", snapshot: {}, receivedAt: "2026-11-08T11:00:00Z", checkedAt: now.toISOString(), message: null } as unknown as MedifySnapshotResult;
    const briefing = buildBriefing({ ...emptyInput, medify: previous }, now);
    if (briefing.attention.state !== "ok") throw new Error("expected ok");
    expect(briefing.attention.items).toEqual([{ text: "Medify hari ini belum masuk; yang tampil data Minggu, 8 November 2026.", href: "/#section-00" }]);
  });

  it("flags a current snapshot older than 13 hours during service hours", () => {
    const received = "2026-11-08T11:00:00Z"; // 18.00 WIB, 14 h before 08.00 WIB
    const medify = (checkedAt: string) => ({ status: "current", snapshot: {}, receivedAt: received, checkedAt, message: null }) as unknown as MedifySnapshotResult;
    const items = (at: Date) => {
      const briefing = buildBriefing({ ...emptyInput, schedule: [row("09:00", "Rapat komite")], medify: medify(at.toISOString()) }, at);
      if (briefing.attention.state !== "ok") throw new Error("expected ok");
      return briefing.attention.items;
    };
    expect(items(now)).toEqual([{ text: "Tarikan Medify terakhir pukul 18.00 WIB; tarikan otomatis tampaknya berhenti.", href: "/#section-00" }]);
    expect(items(new Date("2026-11-09T15:00:00Z"))).toEqual([]); // 22.00 WIB, outside service hours
  });

  it("does not flag a current snapshot within 13 hours", () => {
    const fresh = { status: "current", snapshot: {}, receivedAt: "2026-11-08T20:00:00Z", checkedAt: now.toISOString(), message: null } as unknown as MedifySnapshotResult; // 03.00 WIB, 5 h old
    const briefing = buildBriefing({ ...emptyInput, medify: fresh }, now);
    expect(briefing.attention).toEqual({ state: "ok", items: [] });
  });

  it("flags an empty schedule only after 08:00", () => {
    const texts = (schedule: BriefingInput["schedule"], at: Date) => {
      const briefing = buildBriefing({ ...emptyInput, schedule }, at);
      if (briefing.attention.state !== "ok") throw new Error("expected ok");
      return briefing.attention.items;
    };
    expect(texts([], new Date("2026-11-09T01:30:00Z"))).toEqual([{ text: "Jadwal hari ini belum ada; belum ada sumber data otomatis.", href: "/melinda" }]); // 08.30 WIB
    expect(texts([], new Date("2026-11-09T00:30:00Z"))).toEqual([]); // 07.30 WIB
    expect(texts(null, new Date("2026-11-09T01:30:00Z"))).toEqual([]); // a failed read is not "belum masuk"
  });

  it("keeps the other sections when one source fails", () => {
    const briefing = buildBriefing({ ...emptyInput, tasks: null }, now);
    expect(briefing.tasks).toEqual({ state: "unavailable", message: "Data tugas belum tersedia." });
    expect(briefing.schedule.state).toBe("ok");
  });

  it("says which attention source failed, in words, while the others still show", () => {
    const briefing = buildBriefing({ ...emptyInput, orders: null, pendingReviews: 1 }, now);
    if (briefing.attention.state !== "ok") throw new Error("expected ok");
    expect(briefing.attention.items.map((item) => item.text)).toEqual(["Data order obat belum tersedia.", "1 pengajuan menunggu tinjauan."]);
  });

  it("marks attention unavailable only when every source failed", () => {
    expect(buildBriefing({ ...emptyInput, orders: null, pendingReviews: null, medify: null }, now).attention).toEqual({ state: "unavailable", message: "Data perhatian belum tersedia." });
  });
});

describe("readBriefing", () => {
  it("turns one failing source into a null, leaving the rest", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const call = vi.fn(async (command: string) => {
      if (command === "board") throw new Error("down");
      if (command === "schedule_list") return { date: "2026-11-09", items: [] };
      if (command === "plan") return { date: "2026-11-09", events: [], readiness: [], outbox: [], archives: [] };
      if (command === "list") return { orders: [], decisions: {} };
      if (command === "review_list") return { pending: [], publishedRevisionId: null, published: null };
      return {};
    });
    const briefing = await readBriefing({ store: { call } } as unknown as DirectorAuthConfiguration, now, { medify: missingMedify });
    expect(briefing.tasks).toEqual({ state: "unavailable", message: "Data tugas belum tersedia." });
    expect(briefing.schedule).toEqual({ state: "ok", items: [] });
  });

  it("counts undecided order files without opening any PDF, because only /order-obat carries the PDF worker", async () => {
    const call = vi.fn(async (command: string) => {
      if (command === "board") return { instructions: [] };
      if (command === "plan") return { date: "2026-11-09", events: [], readiness: [], outbox: [], archives: [] };
      if (command === "list") return { orders: [], decisions: { "builtin:november-2026": { orderKey: "builtin:november-2026", decision: "diterima", note: null, decidedBy: "d", decidedAt: "" } } };
      if (command === "review_list") return { pending: [], publishedRevisionId: null, published: null };
      return {};
    });
    const briefing = await readBriefing({ store: { call } } as unknown as DirectorAuthConfiguration, now, { schedule: [], medify: missingMedify });
    expect(JSON.stringify(briefing.attention)).toContain("1 berkas order obat");
    expect(JSON.stringify(briefing.attention)).not.toContain("belum tersedia");
  });

  it("says order data is unavailable when the store cannot be read, rather than counting built-ins as undecided", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const call = vi.fn(async (command: string) => {
      if (command === "list") throw new DirectorStoreError(503, "unavailable");
      if (command === "board") return { instructions: [] };
      if (command === "plan") return { date: "2026-11-09", events: [], readiness: [], outbox: [], archives: [] };
      return { pending: [], publishedRevisionId: null, published: null };
    });
    const briefing = await readBriefing({ store: { call } } as unknown as DirectorAuthConfiguration, now, { schedule: [], medify: missingMedify });
    expect(JSON.stringify(briefing.attention)).toContain("Data order obat belum tersedia.");
  });
});
