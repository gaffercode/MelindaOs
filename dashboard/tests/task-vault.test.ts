import { describe, expect, it } from "vitest";
import type { Instruction } from "../lib/director/director-instructions";
import { buildBaselineSchedule } from "../lib/work-schedule/baseline-schedule";
import {
  COMPLETED_VAULT_TASKS,
  VAULT_TASKS,
  formatFeedbackNote,
  injectTasksIntoSchedule,
  parseFeedbackNote,
  resolveVaultTasks,
} from "../lib/work-schedule/task-vault";

function makeInstruction(overrides: Partial<Instruction>): Instruction {
  return {
    id: "IOC-1001",
    reportDate: "2026-11-19",
    section: "followUps",
    itemId: "ACT-2810-01",
    itemTitle: "Standarisasi & Audit Distribusi Obat",
    urgent: true,
    action: "request_update",
    deadline: null,
    pic: ["Contoh PIC A", "Contoh PIC B"],
    note: "",
    decisionOptionId: null,
    decisionLabel: null,
    status: "dibuat",
    history: [{ status: "dibuat", at: "2026-11-19T08:30:00Z", actor: "Direktur" }],
    createdAt: "2026-11-19T08:30:00Z",
    ...overrides,
  };
}

describe("task-vault", () => {
  it("encodes all active registers and completed historical items without PHI", () => {
    expect(VAULT_TASKS.length).toBeGreaterThanOrEqual(35);
    expect(COMPLETED_VAULT_TASKS.length).toBe(10);
    const domains = new Set(VAULT_TASKS.map((t) => t.domain));
    expect(domains).toEqual(
      new Set(["Keuangan", "Farmasi", "Pelayanan", "Casemix", "Umum", "SDM", "IT", "Eksternal"])
    );
  });

  it("formats and parses structured feedback tags cleanly", () => {
    const note = formatFeedbackNote({
      status: "pending_pihak_ketiga",
      thirdPartyName: "Mitra Contoh",
      text: "Menunggu proposal formal perbankan",
    });
    expect(note).toContain("[STATUS:pending_pihak_ketiga]");
    expect(note).toContain("[PIHAK3:Mitra Contoh]");
    expect(parseFeedbackNote(note)).toEqual({
      status: "pending_pihak_ketiga",
      thirdPartyName: "Mitra Contoh",
      text: "Menunggu proposal formal perbankan",
    });
  });

  it("enforces Rule #39: operational completion claims become menunggu_verifikasi_novia while Director/Wadir can close", () => {
    const staffDone = makeInstruction({
      itemId: "ACT-2610-01",
      action: "done",
      note: formatFeedbackNote({ status: "selesai", text: "Sudah dipindah ke gudang belakang" }),
      history: [{ status: "dibuat", at: "2026-11-19T09:00:00Z", actor: "Staf Struktural" }],
    });

    const directorDone = makeInstruction({
      id: "IOC-1002",
      itemId: "ACT-2810-01",
      action: "done",
      note: formatFeedbackNote({ status: "selesai", text: "Disetujui selesai oleh Direktur" }),
      history: [{ status: "dibuat", at: "2026-11-19T10:00:00Z", actor: "Direktur" }],
    });

    const resolved = resolveVaultTasks([staffDone, directorDone]);
    const tStaff = resolved.find((t) => t.id === "ACT-2610-01");
    const tDir = resolved.find((t) => t.id === "ACT-2810-01");

    expect(tStaff?.status).toBe("menunggu_verifikasi_novia");
    expect(tDir?.status).toBe("selesai");
  });

  it("updates third-party blockers from instruction ledger", () => {
    const thirdPartyUpdate = makeInstruction({
      itemId: "MLOG-18",
      action: "request_update",
      note: formatFeedbackNote({
        status: "pending_pihak_ketiga",
        thirdPartyName: "Mitra Contoh Cabang",
        text: "Menunggu revisi dokumen contoh",
      }),
    });
    const resolved = resolveVaultTasks([thirdPartyUpdate]);
    const btn = resolved.find((t) => t.id === "MLOG-18");
    expect(btn?.status).toBe("pending_pihak_ketiga");
    expect(btn?.thirdPartyName).toBe("Mitra Contoh Cabang");
    expect(btn?.latestNote).toBe("Menunggu revisi dokumen contoh");
  });

  it("injects Finance/Pharmacy/Third-Party tasks into Thursday Tertutup Keuangan/SDM and drops completed tasks", () => {
    const thursdaySlots = buildBaselineSchedule("2026-11-19", "direktur");
    const directorClosedOne = makeInstruction({
      itemId: "ACT-2810-01",
      action: "done",
      note: formatFeedbackNote({ status: "selesai", text: "Laporan contoh selesai" }),
      history: [{ status: "dibuat", at: "2026-11-19T10:00:00Z", actor: "Direktur" }],
    });

    const resolved = resolveVaultTasks([directorClosedOne]);
    const enriched = injectTasksIntoSchedule(thursdaySlots, resolved);

    const tertutupKeu = enriched.find((s) => s.forumId === "tertutup_keuangan_sdm");
    expect(tertutupKeu).toBeDefined();
    expect(tertutupKeu?.injectedTasks.some((t) => t.id === "ACT-2810-01")).toBe(false);
    expect(tertutupKeu?.injectedTasks.some((t) => t.domain === "Keuangan" || t.domain === "Farmasi")).toBe(true);
    expect(tertutupKeu?.combinedTopicSummary).toContain("Bahan injeksi");
  });
});
