import { describe, expect, it } from "vitest";
import { auditClinicalRead, createClinicalEntry, listClinicalEntries, updateClinicalEntry } from "@/lib/clinical/clinical-store";
import { parseClinicalDraft } from "@/lib/clinical/clinical-contract";
import type { DirectorAuthConfiguration } from "@/lib/director/director-auth";

function configWith(responses: Record<string, unknown>) {
  const calls: { command: string; args: Record<string, unknown>; rpc: string }[] = [];
  const config = {
    store: {
      call: async (command: string, args: Record<string, unknown>, rpc: string) => {
        calls.push({ command, args, rpc });
        if (!(command in responses)) throw new Error(`unexpected command ${command}`);
        return responses[command];
      },
    },
  } as unknown as DirectorAuthConfiguration;
  return { config, calls };
}

const draft = parseClinicalDraft({
  kind: "insiden", date: "2026-11-22", shift: null, unit: "Rawat inap",
  payload: { time: "14:05", place: "Aster", type: "KNC", grade: "hijau", chronology: "Obat hampir tertukar.", followUp: "", progress: "baru", reporter: "Ns. C" },
});
const row = (id: string, payload: unknown) => ({ id, kind: "insiden", date: "2026-11-22", shift: null, unit: "Rawat inap", payload, status: "aktif", revision: 1, createdBy: "Direktur", createdAt: "2026-11-22T07:00:00Z", updatedBy: null, updatedAt: null });

describe("clinical store", () => {
  it("creates through the clinical RPC with the client key and the parsed draft", async () => {
    const { config, calls } = configWith({ create: { id: "00000000-0000-4000-8000-000000000001", createdAt: "2026-11-22T07:00:00Z", replayed: false } });
    await createClinicalEntry(config, { key: "key-00000001", draft, actor: "Direktur" });
    expect(calls).toEqual([{ command: "create", rpc: "melinda_clinical", args: { key: "key-00000001", kind: "insiden", date: "2026-11-22", shift: null, unit: "Rawat inap", payload: draft.payload, actor: "Direktur" } }]);
  });

  it("lists with only the filters given and a default limit of 100", async () => {
    const { config, calls } = configWith({ list: { entries: [] } });
    await listClinicalEntries(config, { kind: "roster", from: "2026-11-16" });
    expect(calls[0]).toEqual({ command: "list", rpc: "melinda_clinical", args: { kind: "roster", from: "2026-11-16", limit: 100 } });
  });

  it("drops a stored row whose payload no longer validates", async () => {
    const good = row("00000000-0000-4000-8000-000000000001", draft.payload);
    const corrupt = row("00000000-0000-4000-8000-000000000002", { time: "bad" });
    const { config } = configWith({ list: { entries: [good, corrupt] } });
    const rows = await listClinicalEntries(config, {});
    expect(rows.map((entry) => entry.id)).toEqual([good.id]);
  });

  it("returns the updated entry and sends the revision the caller read", async () => {
    const updated = { ...row("00000000-0000-4000-8000-000000000001", draft.payload), status: "dibatalkan", revision: 2 };
    const { config, calls } = configWith({ update: { entry: updated } });
    const entry = await updateClinicalEntry(config, { id: updated.id, kind: "insiden", revision: 1, status: "dibatalkan", actor: "Direktur" });
    expect(entry.status).toBe("dibatalkan");
    expect(calls[0].args).toMatchObject({ revision: 1, status: "dibatalkan", kind: "insiden" });
  });

  it("writes one audit row per read", async () => {
    const { config, calls } = configWith({ audit_read: { ok: true } });
    const detail = { from: "2026-11-16", to: "2026-11-22", limit: 50, ids: ["00000000-0000-4000-8000-000000000001"] };
    await auditClinicalRead(config, { kind: "handover", reader: "master_token", count: 1, detail });
    expect(calls).toEqual([{ command: "audit_read", rpc: "melinda_clinical", args: { kind: "handover", reader: "master_token", count: 1, detail } }]);
  });
});
