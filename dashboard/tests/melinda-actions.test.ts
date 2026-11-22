import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DirectorAuthConfiguration } from "@/lib/director/director-auth";
import type { Instruction } from "@/lib/director/director-instructions";
import { DirectorStoreError } from "@/lib/director/director-store";
import { ActionInputError, decideAction, proposeAction } from "@/lib/melinda/actions";
import { MELINDA_TOOLS, runTool } from "@/lib/melinda/tools";
import { buildBaselineSchedule } from "@/lib/work-schedule/baseline-schedule";
import { resolveVaultTasks, VAULT_TASKS } from "@/lib/work-schedule/task-vault";

type Call = { command: string; args: Record<string, unknown>; rpc: string };
type Stored = { id: string; owner: string; kind: string; summary: string; payload: unknown; payloadHash: string; status: string };

const now = new Date("2026-11-19T02:00:00Z");
const owner = "director-test";
let calls: Call[];
let actions: Map<string, Stored>;
let created: Instruction[];
let overrides: Record<string, unknown>[];
let missingActions: boolean;

const ioc: Instruction = {
  id: "IOC-5001", reportDate: "2026-11-18", section: "umum", itemId: "MEL-1", itemTitle: "Siapkan bahan rapat yayasan", urgent: false,
  action: "assign", deadline: null, pic: ["PIC Lama"], note: "", decisionOptionId: null, decisionLabel: null, status: "diteruskan",
  history: [{ status: "diteruskan", at: "2026-11-18T03:00:00Z", actor: "Direktur" }], createdAt: "2026-11-18T03:00:00Z",
};

const store = {
  call: vi.fn(async (command: string, args: Record<string, unknown>, rpc: string) => {
    calls.push({ command, args, rpc });
    if (rpc === "melinda_actions") {
      if (missingActions) throw new DirectorStoreError(503, "missing_function");
      if (command === "propose") {
        const id = `00000000-0000-4000-8000-${String(actions.size + 1).padStart(12, "0")}`;
        actions.set(id, { id, owner: args.owner as string, kind: args.kind as string, summary: args.summary as string, payload: structuredClone(args.payload), payloadHash: args.payloadHash as string, status: "pending" });
        return { action: { id, kind: args.kind, summary: args.summary, status: "pending", expiresAt: "2026-11-19T02:15:00Z" } };
      }
      const action = actions.get(args.id as string);
      if (!action || action.owner !== args.owner) throw new DirectorStoreError(404, "not_found");
      if (command === "claim") {
        if (action.status !== "pending") throw new DirectorStoreError(409, "conflict");
        action.status = "confirmed";
        return { action: { id: action.id, kind: action.kind, summary: action.summary, payload: action.payload, payloadHash: action.payloadHash } };
      }
      if (command === "cancel") { if (action.status !== "pending") throw new DirectorStoreError(409, "conflict"); action.status = "cancelled"; return { ok: true }; }
      if (command === "finish") { action.status = args.outcome as string; return { ok: true }; }
    }
    // Like the RPC: a finished row (`action done`) never shows on the board, only in the archive.
    if (rpc === "melinda_director_tasks" && command === "board") return { instructions: created.filter((row) => row.action !== "done") };
    if (rpc === "melinda_director_tasks" && command === "archive") {
      const rows = created.filter((row) => row.action === "done" && row.note.includes(String(args.q ?? "")));
      return { instructions: rows.slice(Number(args.offset), Number(args.offset) + 50), offset: args.offset, pageSize: 50, hasMore: rows.length > Number(args.offset) + 50 };
    }
    if (rpc === "melinda_director_tasks" && command === "director_status") return { instruction: { ...ioc, status: "selesai" } };
    if (rpc === "melinda_director_tasks" && command === "schedule_replace") return { date: args.date, count: (args.items as unknown[]).length };
    if (rpc === "melinda_director_instructions" && command === "read") {
      if (args.id === ioc.id) return { instruction: ioc };
      throw new DirectorStoreError(404, "not_found");
    }
    if (rpc === "melinda_director_instructions" && command === "create") {
      const instruction = { ...(args as unknown as Instruction), id: `IOC-${6000 + created.length}`, status: "dibuat", history: [{ status: "dibuat", at: now.toISOString(), actor: args.reviewerId as string }], createdAt: new Date(now.getTime() + created.length * 1000).toISOString() } as Instruction;
      created.push(instruction);
      return { instruction, replayed: false };
    }
    if (rpc === "melinda_director_officials") return { officials: ["Bapak Heri Contoh", "Ibu Heri Lain"] };
    if (rpc === "melinda_schedule_overrides" && command === "list") return { overrides };
    if (rpc === "melinda_schedule_overrides" && command === "add") {
      const row = { ...args, id: `ovr${overrides.length + 1}`, createdAt: now.toISOString() };
      overrides.push(row);
      return { override: row };
    }
    return {};
  }),
};
const config = { store } as unknown as DirectorAuthConfiguration;
const writes = () => calls.filter((call) => (call.rpc === "melinda_director_instructions" && call.command === "create") || call.command === "director_status" || call.command === "schedule_replace" || (call.rpc === "melinda_schedule_overrides" && call.command === "add"));

beforeEach(() => {
  calls = []; actions = new Map(); created = []; overrides = []; missingActions = false;
  store.call.mockClear();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("Melinda proposals", () => {
  const task = VAULT_TASKS[0];

  it("prepares a PIC change without writing, then moves the PIC and keeps the status on Konfirmasi", async () => {
    const before = resolveVaultTasks([]).find((item) => item.id === task.id)!;
    const proposal = await proposeAction(config, { owner, conversationId: null, now, kind: "ganti_pic", input: { task_id: task.id, pic: ["PIC Baru"] } });
    expect(proposal.summary).toContain(`${before.pic.join(", ")} → PIC Baru`);
    expect(writes()).toEqual([]);

    const outcome = await decideAction(config, { owner, id: proposal.id, decision: "confirm", now });
    expect(outcome.status).toBe("executed");
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ itemId: task.id, action: "assign", pic: ["PIC Baru"], reviewerId: "Direktur (via /melinda)" });
    const after = resolveVaultTasks(created).find((item) => item.id === task.id)!;
    expect(after.pic).toEqual(["PIC Baru"]);
    expect(after.status).toBe(before.status);
    expect(actions.get(proposal.id)?.status).toBe("executed");
  });

  it("runs a confirmed proposal once", async () => {
    const proposal = await proposeAction(config, { owner, conversationId: null, now, kind: "status_tugas", input: { task_id: task.id, status: "selesai" } });
    await decideAction(config, { owner, id: proposal.id, decision: "confirm", now });
    await expect(decideAction(config, { owner, id: proposal.id, decision: "confirm", now })).rejects.toMatchObject({ status: 409 });
    expect(created).toHaveLength(1);
    expect(resolveVaultTasks(created).find((item) => item.id === task.id)?.status).toBe("selesai");
  });

  it("keeps a task the Director closed as selesai after its row moves to the archive", async () => {
    const proposal = await proposeAction(config, { owner, conversationId: null, now, kind: "status_tugas", input: { task_id: task.id, status: "selesai" } });
    await decideAction(config, { owner, id: proposal.id, decision: "confirm", now });
    expect(created[0].action).toBe("done");
    const read = await runTool("baca_task_vault", {}, { config, now, owner, conversationId: null });
    expect(read.text).toContain(task.id);
    expect(read.text).toMatch(new RegExp(`"id":"${task.id}"[^}]*"status":"selesai"`));
  });

  it("keeps a vault task's status when a follow-up on it is confirmed", async () => {
    const pending = await proposeAction(config, { owner, conversationId: null, now, kind: "status_tugas", input: { task_id: task.id, status: "pending_pihak_ketiga", pihak_ketiga: "BPJS" } });
    await decideAction(config, { owner, id: pending.id, decision: "confirm", now });
    const followUp = await proposeAction(config, { owner, conversationId: null, now, kind: "tindak_lanjut", input: { task_id: task.id, pic: ["PIC Lama"], tenggat: "2026-11-21T10:00" } });
    await decideAction(config, { owner, id: followUp.id, decision: "confirm", now });
    expect(created).toHaveLength(2);
    expect(created[1]).toMatchObject({ action: "request_update", itemId: task.id });
    expect(resolveVaultTasks(created).find((item) => item.id === task.id)).toMatchObject({ status: "pending_pihak_ketiga", thirdPartyName: "BPJS" });
  });

  it("reads the vault status again on Konfirmasi, so a report in the meantime is not overwritten", async () => {
    const proposal = await proposeAction(config, { owner, conversationId: null, now, kind: "ganti_pic", input: { task_id: task.id, pic: ["PIC Baru"] } });
    const report = await proposeAction(config, { owner, conversationId: null, now, kind: "status_tugas", input: { task_id: task.id, status: "butuh_keputusan_direktur" } });
    await decideAction(config, { owner, id: report.id, decision: "confirm", now });
    await decideAction(config, { owner, id: proposal.id, decision: "confirm", now });
    expect(resolveVaultTasks(created).find((item) => item.id === task.id)).toMatchObject({ status: "butuh_keputusan_direktur", pic: ["PIC Baru"] });
  });

  it("shows every text the change writes in the summary the Director confirms", async () => {
    const pic = await proposeAction(config, { owner, conversationId: null, now, kind: "ganti_pic", input: { task_id: task.id, pic: ["PIC Baru"], catatan: "Mulai Senin" } });
    expect(pic.summary).toContain('Catatan: "Mulai Senin"');
    const [first] = buildBaselineSchedule("2026-11-19", "direktur").filter((slot) => slot.category !== "Break");
    const move = await proposeAction(config, { owner, conversationId: null, now, kind: "ubah_jadwal", input: { jenis: "pindah", slot_id: first.id, mulai: "21:00", judul: "Nama baru", catatan: "Atas permintaan yayasan", tanggal: "2026-11-19" } });
    expect(move.summary).toContain('judul baru "Nama baru"');
    expect(move.summary).toContain('Catatan: "Atas permintaan yayasan"');
  });

  it("refuses a proposal whose stored payload no longer matches its hash", async () => {
    const proposal = await proposeAction(config, { owner, conversationId: null, now, kind: "ganti_pic", input: { task_id: task.id, pic: ["PIC Baru"] } });
    (actions.get(proposal.id)!.payload as { pic: string[] }).pic = ["Orang Lain"];
    await expect(decideAction(config, { owner, id: proposal.id, decision: "confirm", now })).rejects.toMatchObject({ status: 409 });
    expect(writes()).toEqual([]);
    expect(actions.get(proposal.id)?.status).toBe("failed");
  });

  it("cancels without writing and keeps another owner out", async () => {
    const proposal = await proposeAction(config, { owner, conversationId: null, now, kind: "sinkron", input: {} });
    await expect(decideAction(config, { owner: "someone-else", id: proposal.id, decision: "confirm", now })).rejects.toMatchObject({ status: 404 });
    expect((await decideAction(config, { owner, id: proposal.id, decision: "cancel", now })).status).toBe("cancelled");
    await expect(decideAction(config, { owner, id: proposal.id, decision: "confirm", now })).rejects.toMatchObject({ status: 409 });
    expect(writes()).toEqual([]);
  });

  it("moves an IOC instruction to a new PIC by a linked instruction and closes the old one", async () => {
    const proposal = await proposeAction(config, { owner, conversationId: null, now, kind: "ganti_pic", input: { task_id: ioc.id, pic: ["PIC Baru"] } });
    await decideAction(config, { owner, id: proposal.id, decision: "confirm", now });
    expect(created[0]).toMatchObject({ itemId: ioc.itemId, action: "assign", pic: ["PIC Baru"], linkedId: ioc.id });
    expect(calls.find((call) => call.command === "director_status")?.args).toMatchObject({ id: ioc.id, status: "dibatalkan" });
  });

  it("records a follow-up and a new task as instructions with a deadline", async () => {
    const followUp = await proposeAction(config, { owner, conversationId: null, now, kind: "tindak_lanjut", input: { task_id: ioc.id, pic: ["PIC Lama"], tenggat: "2026-11-21T10:00" } });
    const fresh = await proposeAction(config, { owner, conversationId: null, now, kind: "tugas_baru", input: { judul: "Rekap klaim November", pic: ["PIC Baru"], tenggat: "2026-11-25T12:00", mendesak: true } });
    await decideAction(config, { owner, id: followUp.id, decision: "confirm", now });
    await decideAction(config, { owner, id: fresh.id, decision: "confirm", now });
    expect(created[0]).toMatchObject({ action: "request_update", deadline: "2026-11-21T10:00", linkedId: ioc.id, section: "followUps" });
    expect(created[1]).toMatchObject({ action: "request_update", deadline: "2026-11-25T12:00", section: "umum", urgent: true, itemTitle: "Rekap klaim November" });
  });

  it("rejects unknown tasks, patient data and bad deadlines before storing anything", async () => {
    await expect(proposeAction(config, { owner, conversationId: null, now, kind: "ganti_pic", input: { task_id: "ACT-0000-99", pic: ["X"] } })).rejects.toBeInstanceOf(ActionInputError);
    await expect(proposeAction(config, { owner, conversationId: null, now, kind: "tugas_baru", input: { judul: "Kontrol Ny. Sari", pic: ["X"], catatan: "NIK 3571234567890001" } })).rejects.toBeInstanceOf(ActionInputError);
    await expect(proposeAction(config, { owner, conversationId: null, now, kind: "tindak_lanjut", input: { judul: "Cek", pic: ["X"], tenggat: "besok" } })).rejects.toBeInstanceOf(ActionInputError);
    expect(actions.size).toBe(0);
  });

  it("moves a Director meeting, shows the clash, and rewrites the Director's day on Konfirmasi", async () => {
    const date = "2026-11-19";
    const [first, second] = buildBaselineSchedule(date, "direktur").filter((slot) => slot.category !== "Break");
    const proposal = await proposeAction(config, { owner, conversationId: null, now, kind: "ubah_jadwal", input: { jenis: "pindah", slot_id: first.id, mulai: second.startTime, tanggal: date } });
    expect(proposal.summary).toContain(`Pindah "${first.title}"`);
    expect(proposal.summary).toContain("Bentrok dengan");
    expect(writes()).toEqual([]);

    await decideAction(config, { owner, id: proposal.id, decision: "confirm", now });
    expect(overrides).toHaveLength(1);
    const replaced = calls.find((call) => call.command === "schedule_replace")!;
    const items = replaced.args.items as { start: string; title: string }[];
    expect(items.find((item) => item.title === first.title.slice(0, 120))?.start).toBe(second.startTime);
  });

  it("answers a schedule change for an unknown meeting as a refusal the model can read", async () => {
    const result = await runTool("usulkan_ubah_jadwal", { jenis: "batal", slot_id: "tidak-ada", tanggal: "2026-11-19" }, { config, now, owner, conversationId: null });
    expect(result.isError).toBe(false);
    expect(result.text).toContain("ditolak");
    expect(result.text).toContain("tidak-ada");
    expect(result.proposal).toBeUndefined();
    expect(actions.size).toBe(0);
  });

  it("stays inside the API limits for strict tools", () => {
    type Schema = { type?: string; properties?: Record<string, Schema & { anyOf?: unknown }>; required?: string[]; items?: Schema };
    let optional = 0;
    const walk = (schema: Schema | undefined) => {
      for (const [key, value] of Object.entries(schema?.properties ?? {})) {
        if (!(schema?.required ?? []).includes(key)) optional += 1;
        expect(value.anyOf).toBeUndefined();
        walk(value); walk(value.items);
      }
    };
    const strict = MELINDA_TOOLS.filter((tool) => tool.strict);
    strict.forEach((tool) => walk(tool.input_schema as Schema));
    expect(strict.length).toBeLessThanOrEqual(20);
    expect(optional).toBeLessThanOrEqual(20);
  });

  it("tells the model the feature is not active while the migration is missing", async () => {
    missingActions = true;
    const result = await runTool("usulkan_sinkron", {}, { config, now, owner, conversationId: null });
    expect(result.isError).toBe(false);
    expect(result.text).toContain("belum_aktif");
    expect(result.proposal).toBeUndefined();
  });

  it("lists officials matching a name so Melinda can ask when two match", async () => {
    const result = await runTool("cari_pejabat", { nama: "heri" }, { config, now, owner, conversationId: null });
    expect(result.text).toContain("Bapak Heri Contoh");
    expect(result.text).toContain("Ibu Heri Lain");
  });
});
