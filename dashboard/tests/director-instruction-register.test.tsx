import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DirectorInstructionRegister, overdue, sortRegister } from "@/components/director/director-instruction-register";
import type { Instruction } from "@/lib/director/director-instructions";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const today = "2026-10-28";
// 10:30 WIB on the report date.
const now = new Date("2026-10-28T03:30:00Z");
let rows: Instruction[];

function row(id: string, reportDate: string, status: Instruction["status"], extra: Partial<Instruction> = {}): Instruction {
  return { id, reportDate, section: "followUps", itemId: `FU-${id}`, itemTitle: `Item ${id}`, urgent: false, action: "request_update", deadline: null, pic: [], note: "", decisionOptionId: null, decisionLabel: null, status, history: [], createdAt: `${reportDate}T01:00:00Z`, ...extra };
}

beforeEach(() => {
  rows = [
    row("IOC-0001", "2026-10-20", "diteruskan", { deadline: "2026-10-27T16:00", pic: ["Kabag Pelayanan – Nama Pejabat"] }),
    row("IOC-0002", "2026-10-15", "diterima_pic", { deadline: "2026-10-30T09:00" }),
    row("IOC-0003", "2026-10-28", "terkirim_ke_grokbot", { section: "umum", itemId: "UMUM-20261028-abc123", itemTitle: "Cek kesiapan genset", note: "Sebelum akreditasi" }),
    row("IOC-0004", "2026-10-26", "gagal", { deadline: "2026-10-26T09:00" }),
    row("IOC-0005", "2026-10-21", "terkendala", { history: [{ status: "diteruskan", at: "2026-10-21T01:00:00Z", actor: "bot" }, { status: "terkendala", at: "2026-10-21T02:00:00Z", actor: "bot", note: "Menunggu berkas klaim" }] }),
  ];
  vi.stubEnv("MELINDAOS_DIRECTOR_STORE", "supabase");
  vi.stubEnv("MELINDAOS_APP_ORIGIN", "https://synthetic.example");
  vi.stubEnv("MELINDAOS_SUPABASE_URL", "https://synthetic.supabase.co");
  vi.stubEnv("MELINDAOS_SUPABASE_SECRET_KEY", "sb_secret_synthetic");
  vi.stubEnv("MELINDAOS_REVIEWER_PASSCODE_HASH", `scrypt$${"0".repeat(32)}$${"0".repeat(128)}`);
  vi.stubEnv("MELINDAOS_REVIEWER_ID", "director-test");
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
    const { command, args } = JSON.parse(init.body as string) as { command: string; args: Record<string, string> };
    if (command === "open") return Response.json({ instructions: rows.filter((item) => item.reportDate >= args.from && item.reportDate <= args.to && item.status !== "selesai" && item.action !== "done") });
    return Response.json({ errorCode: "invalid_command" });
  });
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("Director instruction register", () => {
  it("orders overdue instructions first, then by date, and marks only their deadline", async () => {
    const html = renderToStaticMarkup(await DirectorInstructionRegister({ today, days: 14, now }));
    const order = [...html.matchAll(/IOC-\d{4}/g)].map((match) => match[0]).filter((id, index, all) => all.indexOf(id) === index);
    expect(order).toEqual(["IOC-0001", "IOC-0002", "IOC-0005", "IOC-0004", "IOC-0003"]);
    expect(html).toContain("5 arahan, 1 lewat tenggat");
    expect(html).toContain("instruction-blocked");
    expect(html).toContain("Terkendala · Menunggu berkas klaim");
    expect(html).toContain("Umum: </span>Cek kesiapan genset");
    expect(html).toContain("Sebelum akreditasi");
    expect(html).toContain("Kabag Pelayanan – Nama Pejabat");
    expect(html).toContain("Grup default");
    expect(html).toContain("Gagal terkirim");
    expect(html).toContain('href="/?tanggal=2026-10-20"');
    expect(html.match(/text-\[color:var\(--warn\)\]/g)).toHaveLength(2);
    expect(html).toContain("Arahan baru");
    expect(html).not.toContain("badge");
  });
  it("tells the Director when the window holds nothing", async () => {
    rows = [];
    const html = renderToStaticMarkup(await DirectorInstructionRegister({ today, days: 7, now }));
    expect(html).toContain("Tidak ada arahan terbuka dalam 7 hari terakhir.");
  });
  it("explains file mode and an unreadable store instead of rendering an empty table", async () => {
    vi.stubEnv("MELINDAOS_DIRECTOR_STORE", "file");
    expect(renderToStaticMarkup(await DirectorInstructionRegister({ today, days: 14, now }))).toContain("hanya tersedia dalam mode terlindung");
    vi.stubEnv("MELINDAOS_DIRECTOR_STORE", "supabase");
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", async () => new Response(null, { status: 500 }));
    expect(renderToStaticMarkup(await DirectorInstructionRegister({ today, days: 14, now }))).toContain("belum dapat dibaca");
  });
  it("treats a deadline as overdue only once delivered and past the WIB clock", () => {
    const nowWib = "2026-10-28T10:30";
    expect(overdue(row("IOC-1", "2026-10-27", "diteruskan", { deadline: "2026-10-28T10:00" }), nowWib)).toBe(true);
    expect(overdue(row("IOC-2", "2026-10-27", "diteruskan", { deadline: "2026-10-28T11:00" }), nowWib)).toBe(false);
    expect(overdue(row("IOC-3", "2026-10-27", "gagal", { deadline: "2026-10-28T10:00" }), nowWib)).toBe(false);
    expect(sortRegister([row("IOC-5", "2026-10-27", "diteruskan"), row("IOC-4", "2026-10-26", "diteruskan")], nowWib).map((item) => item.id)).toEqual(["IOC-4", "IOC-5"]);
  });
});
