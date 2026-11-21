import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ArchiveRow, ArchiveView, recapHref, recapMonths } from "@/components/tasks/archive-view";
import { decisionBody, filterTasks, hiddenReplies, newestLinked, postJson, scheduleInstruction, type BoardTask } from "@/components/tasks/board-client";
import { BoardSummary } from "@/components/tasks/board-summary";
import { KendalaCard, PerluDibacaCard, sendDecision } from "@/components/tasks/kendala-card";
import { sendScheduleAction, TodaySchedule } from "@/components/tasks/today-schedule";
import type { ScheduleRow, StaffReply } from "@/lib/tasks/store";

afterEach(() => vi.unstubAllGlobals());

const item: ScheduleRow = {
  id: "0b7c2f5e-1d2a-4c3b-9e8f-112233445566", date: "2026-11-07", position: 0, start: "09:00", end: "10:00",
  title: "Rapat komite medik", place: "Ruang rapat lt. 2", topic: null, pic: ["dr. Novia"], producer: "dash", createdAt: "2026-11-07T00:00:00Z", taskIds: [],
};
const reply = (patch: Partial<StaffReply> = {}): StaffReply => ({
  id: "r-1", instructionId: "IOC-0042", key: "reply:IOC-0042:m1", receivedAt: "2026-11-07T03:10:00Z", fromName: "Bu Oriza",
  originalText: "Pak, AC ruang bersalin mati sejak pagi, teknisi belum datang.", attachments: [{ url: "https://example.test/foto1.jpg", mime: "image/jpeg" }],
  summary: "AC ruang bersalin mati", needs: "Persetujuan panggil teknisi luar", classifiedStatus: "terkendala", confidence: 0.9, producer: "dash", createdAt: "2026-11-07T03:10:05Z", ...patch,
});
const task = (patch: Partial<BoardTask> = {}): BoardTask => ({
  id: "IOC-0042", reportDate: "2026-11-07", section: "umum", itemId: "x", itemTitle: "Perbaikan AC VK", urgent: false, action: "assign", deadline: null,
  pic: ["Kepala Umum"], note: "", decisionOptionId: null, decisionLabel: null, status: "terkendala",
  history: [{ status: "terkirim_ke_grokbot", at: "2026-11-07T01:00:00Z", actor: "director" }, { status: "terkendala", at: "2026-11-07T03:10:00Z", actor: "dash" }],
  createdAt: "2026-11-07T01:00:00Z", linkedId: null, scheduleItemId: null, remindersSent: 0, lastReminderAt: null, latestReply: reply(), overdue: false, reminder: "none", ...patch,
});
const noop = () => {};

function stubFetch() {
  const calls: { url: string; init: RequestInit }[] = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return Response.json({ instruction: { id: "IOC-0050" } });
  });
  return calls;
}

describe("Today's schedule", () => {
  it("one tap on Setuju posts the approve instruction for the schedule item", async () => {
    const calls = stubFetch();
    await sendScheduleAction(item, "approve", "", "csrf-1", "key-12345678");
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("/api/director/instructions");
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.headers).toMatchObject({ "X-CSRF-Token": "csrf-1", "Idempotency-Key": "key-12345678", "Content-Type": "application/json" });
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      reportDate: "2026-11-07", section: "umum", itemId: item.id, itemTitle: "Rapat komite medik", urgent: false, action: "approve",
      deadline: null, pic: ["dr. Novia"], note: "", decisionOptionId: null, decisionLabel: null, linkedId: null, scheduleItemId: item.id,
    });
  });
  it("shows the row with its three buttons", () => {
    const html = renderToStaticMarkup(<TodaySchedule items={[item]} tasks={[]} csrf="c" onDone={noop} />);
    expect(html).toContain("09.00–10.00");
    expect(html).toContain("Rapat komite medik");
    expect(html).toContain("Ruang rapat lt. 2");
    expect(html).toContain("dr. Novia");
    expect(html).toContain(">Setuju</button>");
    expect(html).toContain(">Tolak / tunda</button>");
    expect(html).toContain(">Arahan</button>");
  });
  it("shows the newest linked task's status chip instead of the buttons", () => {
    const linked = { ...item, taskIds: ["IOC-0040", "IOC-0042"] };
    const html = renderToStaticMarkup(<TodaySchedule items={[linked]} tasks={[task({ id: "IOC-0040", status: "selesai" }), task({ status: "diteruskan", overdue: true })]} csrf="c" onDone={noop} />);
    expect(html).toContain("IOC-0042 · Diteruskan");
    expect(html).not.toContain("IOC-0040");
    expect(html).toContain("Terlambat");
    expect(html).not.toContain(">Setuju</button>");
  });
  it("disables Arahan with a plain hint when Dash sent no PIC", () => {
    const html = renderToStaticMarkup(<TodaySchedule items={[{ ...item, pic: [] }]} tasks={[]} csrf="c" onDone={noop} />);
    expect(html).toContain("PIC belum diisi Dash");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Arahan<\/button>/);
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*>Setuju<\/button>/);
  });
  it("says so when Dash has not sent today's schedule", () => {
    const html = renderToStaticMarkup(<TodaySchedule items={[]} tasks={[]} csrf="c" onDone={noop} />);
    expect(html).toContain("Jadwal hari ini belum dikirim Dash.");
  });
  it("builds an assign instruction with the note", () => {
    expect(scheduleInstruction(item, "assign", " Siapkan notulen ")).toMatchObject({ action: "assign", note: "Siapkan notulen", pic: ["dr. Novia"] });
  });
});

describe("Kendala card", () => {
  it("hides the original message until expanded and lists photos as links", () => {
    const html = renderToStaticMarkup(<KendalaCard task={task()} csrf="c" onDone={noop} />);
    expect(html).toContain("AC ruang bersalin mati");
    expect(html).toContain("Yang dibutuhkan: Persetujuan panggil teknisi luar");
    expect(html).toMatch(/<details[^>]*><summary[^>]*>Lihat pesan asli<\/summary>/);
    expect(html).not.toMatch(/<details[^>]*open/);
    expect(html).toContain('href="https://example.test/foto1.jpg"');
    for (const label of ["Putuskan", "Alihkan", "Tunda", "Hubungi saya"]) expect(html).toContain(`>${label}</button>`);
    expect(html).not.toContain("Batalkan");
  });
  it("alihkan without a PIC shows validation and posts nothing", async () => {
    const calls = stubFetch();
    expect(decisionBody("alihkan", "", " , ")).toEqual({ error: "Tulis minimal satu PIC." });
    await expect(sendDecision("IOC-0042", "alihkan", "", "", "c")).rejects.toThrow("Tulis minimal satu PIC.");
    expect(calls).toHaveLength(0);
  });
  it("splits Alihkan PICs on commas and posts the decision", async () => {
    const calls = stubFetch();
    await sendDecision("IOC-0042", "alihkan", "", "Kepala Umum, Teknisi", "csrf-2");
    expect(calls[0].url).toBe("/api/director/tasks/IOC-0042/decision");
    expect(calls[0].init.headers).toMatchObject({ "X-CSRF-Token": "csrf-2" });
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ kind: "alihkan", pic: ["Kepala Umum", "Teknisi"] });
  });
  it("requires a note for Putuskan", () => {
    expect(decisionBody("putuskan", "  ", "")).toEqual({ error: "Tulis keputusannya dulu." });
    expect(decisionBody("putuskan", "Panggil teknisi luar", "")).toEqual({ body: { kind: "putuskan", note: "Panggil teknisi luar" } });
    expect(decisionBody("tunda", "", "")).toEqual({ body: { kind: "tunda" } });
  });
  it("shows a perlu_dibaca reply verbatim with Sudah dibaca and Tandai selesai", () => {
    const html = renderToStaticMarkup(<PerluDibacaCard task={task({ status: "dikerjakan", latestReply: reply({ classifiedStatus: "perlu_dibaca", originalText: "Mohon arahan soal jadwal jaga." }) })} csrf="c" onDone={noop} onHide={noop} />);
    expect(html).toContain("Perlu dibaca");
    expect(html).toContain("Mohon arahan soal jadwal jaga.");
    expect(html).toContain(">Sudah dibaca</button>");
    expect(html).toContain(">Tandai selesai</button>");
  });
  it("remembers hidden replies, and falls back to memory when storage throws", () => {
    const store = new Map<string, string>();
    const storage = { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => void store.set(key, value) };
    hiddenReplies.add("r-1", storage);
    expect(hiddenReplies.read(storage).has("r-1")).toBe(true);
    const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    hiddenReplies.add("r-2", broken);
    expect(hiddenReplies.read(broken).has("r-2")).toBe(true);
  });
});

describe("Photo links", () => {
  it("renders only https attachments, keyed even when urls repeat", () => {
    const attachments = [{ url: "https://example.test/a.jpg", mime: "image/jpeg" }, { url: "https://example.test/a.jpg", mime: "image/jpeg" }, { url: "javascript:alert(1)", mime: "image/jpeg" }, { url: "http://example.test/b.jpg", mime: "image/jpeg" }];
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const html = renderToStaticMarkup(<KendalaCard task={task({ latestReply: reply({ attachments }) })} csrf="c" onDone={noop} />);
    expect(html.match(/href="https:\/\/example.test\/a.jpg"/g)).toHaveLength(2);
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("http://example.test/b.jpg");
    const archiveHtml = renderToStaticMarkup(<ArchiveRow row={task()} replies={[reply({ attachments })]} />);
    expect(archiveHtml).not.toContain("javascript:");
    expect(archiveHtml).not.toContain("http://example.test/b.jpg");
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("Kendala card with a decision already sent", () => {
  const linked = task({ id: "IOC-0050", status: "diteruskan", linkedId: "IOC-0042", latestReply: null });
  it("shows the sent decision and offers no second one, keeping Tunda and Tandai selesai", () => {
    const html = renderToStaticMarkup(<KendalaCard task={task()} linked={linked} csrf="c" onDone={noop} />);
    expect(html.replace(/<[^>]+>/g, "")).toContain("Keputusan dikirim: IOC-0050 · Diteruskan");
    expect(html).not.toContain(">Putuskan</button>");
    expect(html).not.toContain(">Alihkan</button>");
    expect(html).not.toContain(">Hubungi saya</button>");
    expect(html).toContain(">Tunda</button>");
    expect(html).toContain(">Tandai selesai</button>");
  });
  it("offers all actions when nothing was sent", () => {
    const html = renderToStaticMarkup(<KendalaCard task={task()} csrf="c" onDone={noop} />);
    expect(html).not.toContain("Keputusan dikirim");
    for (const label of ["Putuskan", "Alihkan", "Tunda", "Hubungi saya", "Tandai selesai"]) expect(html).toContain(`>${label}</button>`);
  });
  it("Tandai selesai posts the selesai decision", async () => {
    const calls = stubFetch();
    await sendDecision("IOC-0042", "selesai", "", "", "csrf-3");
    expect(calls[0].url).toBe("/api/director/tasks/IOC-0042/decision");
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ kind: "selesai" });
  });
  it("picks the newest linked task from the board", () => {
    const older = task({ id: "IOC-0049", linkedId: "IOC-0042", createdAt: "2026-11-07T04:00:00Z" });
    const newer = task({ id: "IOC-0050", linkedId: "IOC-0042", createdAt: "2026-11-07T05:00:00Z" });
    expect(newestLinked([older, newer, task()], "IOC-0042")?.id).toBe("IOC-0050");
    expect(newestLinked([task()], "IOC-0042")).toBeUndefined();
  });
});

describe("Tanpa balasan", () => {
  it("shows the count only when above zero, as a red-orange filter link", () => {
    const html = renderToStaticMarkup(<BoardSummary summary={{ open: 5, overdue: 0, kendala: 0, escalated: 2 }} active={null} />);
    expect(html).toContain('href="/arahan?tugas=tanpa_balasan"');
    expect(html.replace(/<[^>]+>/g, "")).toContain("5 tugas terbuka · 0 terlambat · 0 ada kendala · 2 tanpa balasan");
    expect(html).toMatch(/class="task-link task-warn"[^>]*>2 tanpa balasan/);
    expect(renderToStaticMarkup(<BoardSummary summary={{ open: 5, overdue: 0, kendala: 0, escalated: 0 }} active={null} />)).not.toContain("tanpa balasan");
  });
  it("filters escalated open tasks", () => {
    const tasks = [task({ id: "IOC-1", reminder: "escalated", status: "diteruskan" }), task({ id: "IOC-2", reminder: "due" }), task({ id: "IOC-3", reminder: "escalated", status: "selesai" })];
    expect(filterTasks(tasks, "tanpa_balasan").map((t) => t.id)).toEqual(["IOC-1"]);
  });
});

describe("Archive recap month", () => {
  it("lists the current month and the previous 11 across a year boundary", () => {
    const months = recapMonths("2026-02");
    expect(months).toHaveLength(12);
    expect(months[0]).toEqual({ value: "2026-02", label: "Februari 2026" });
    expect(months[2]).toEqual({ value: "2025-12", label: "Desember 2025" });
    expect(months[11]).toEqual({ value: "2025-03", label: "Maret 2025" });
  });
  it("links the recap for the selected month, defaulting to the current one", () => {
    expect(recapHref("2026-10")).toBe("/api/director/tasks/recap?bulan=2026-10");
    const html = renderToStaticMarkup(<ArchiveView month="2026-11" />);
    expect(html).toContain('href="/api/director/tasks/recap?bulan=2026-11"');
    expect(html).toContain(">Unduh rekap</a>");
    expect(html).toContain("Desember 2025");
    expect(html).not.toContain("Unduh rekap bulan ini");
  });
});

describe("Archive provenance", () => {
  it("puts the source behind the info icon", () => {
    const html = renderToStaticMarkup(<ArchiveView month="2026-11" />);
    expect(html).toContain("source-info");
    expect(html).toContain("Buku besar arahan di Supabase");
  });
});

describe("Summary", () => {
  it("shows the counts as filter links", () => {
    const html = renderToStaticMarkup(<BoardSummary summary={{ open: 5, overdue: 2, kendala: 1, escalated: 0 }} active={null} />);
    expect(html).toContain('href="/arahan?tugas=terbuka"');
    expect(html).toContain('href="/arahan?tugas=terlambat"');
    expect(html).toContain('href="/arahan?tugas=kendala"');
    expect(html.replace(/<[^>]+>/g, "")).toContain("5 tugas terbuka · 2 terlambat · 1 ada kendala");
  });
});

describe("Archive", () => {
  it("expands a row to its full history", () => {
    const html = renderToStaticMarkup(<ArchiveRow row={task({ status: "selesai" })} />);
    expect(html).toContain("IOC-0042");
    expect(html).toContain("Perbaikan AC VK");
    expect(html).toMatch(/<details/);
    expect(html).toContain("Menunggu diteruskan");
  });
});

describe("postJson", () => {
  it("surfaces the API error message", async () => {
    vi.stubGlobal("fetch", async () => Response.json({ error: "Sesi berakhir." }, { status: 401 }));
    await expect(postJson("/x", {}, "c")).rejects.toThrow("Sesi berakhir.");
  });
});
