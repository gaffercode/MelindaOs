import { describe, expect, it } from "vitest";
import type { DirectorAuthConfiguration } from "@/lib/director/director-auth";
import { parseReferralPayload } from "@/lib/referral/referral-contract";
import { listInboxReferrals, listReferrals, submitReferral, updateReferralStatus } from "@/lib/referral/referral-store";
import { emptyReferralDraft, type StoredReferral } from "@/lib/referral/referral-types";

function validPayload() {
  const draft = emptyReferralDraft("2026-11-16", "09:30");
  draft.patient = { name: "Pasien QA", birthDate: "1992-03-04", age: "", sex: "P", rm: "", nik: "" };
  draft.referrer = { facilityType: "Klinik", facility: "Klinik QA", city: "Kediri Kota", doctor: "dr. QA", phone: "081234567890" };
  draft.clinical = { ...draft.clinical, profileId: "hipertensi_dewasa", chiefComplaint: "nyeri_kepala", diagnosis: "Hipertensi", reason: "Kontrol" };
  draft.consent = true;
  return parseReferralPayload(draft);
}

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

describe("referral store", () => {
  it("submits through the referrals RPC with the client key and the parsed payload", async () => {
    const payload = validPayload();
    const { config, calls } = configWith({ submit: { reference: "RJ-20261116-ABCDEF12", receivedAt: "2026-11-16T02:30:00Z", replayed: false } });
    const receipt = await submitReferral(config, { key: "key-00000001", payload });
    expect(receipt.reference).toBe("RJ-20261116-ABCDEF12");
    expect(calls).toEqual([{ command: "submit", args: { key: "key-00000001", payload }, rpc: "melinda_referrals" }]);
  });

  it("drops a stored row whose payload no longer validates", async () => {
    const payload = validPayload();
    const valid = { id: "00000000-0000-4000-8000-000000000001", reference: "RJ-20261116-ABCDEF12", receivedAt: "2026-11-16T02:30:00Z", status: "baru", payload, note: null, handledBy: null, handledAt: null };
    const corrupt = { ...valid, id: "00000000-0000-4000-8000-000000000002", payload: { patient: {} } };
    const { config, calls } = configWith({ list: { referrals: [valid, corrupt] } });
    const rows = await listReferrals(config, { limit: 25 });
    expect(rows).toHaveLength(1);
    expect(rows[0].payload.patient.name).toBe("Pasien QA");
    expect(calls[0]).toEqual({ command: "list", args: { limit: 25 }, rpc: "melinda_referrals" });
  });

  it("keeps an unhandled referral in the inbox when more than 100 newer ones exist", async () => {
    const payload = validPayload();
    const row = (index: number, status: string, receivedAt: string) => ({ id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`, reference: `RJ-20261116-${String(index).padStart(8, "0")}`, receivedAt, status, payload, note: null, handledBy: null, handledAt: null });
    const newestClosed = Array.from({ length: 100 }, (_, index) => row(index + 1, "selesai", `2026-11-16T05:${String(index % 60).padStart(2, "0")}:00Z`));
    const oldUnhandled = row(500, "baru", "2026-11-10T02:00:00Z");
    const calls: Record<string, unknown>[] = [];
    const config = { store: { call: async (_command: string, args: Record<string, unknown>) => {
      calls.push(args);
      return { referrals: args.status === "baru" ? [oldUnhandled] : args.status ? [] : newestClosed };
    } } } as unknown as DirectorAuthConfiguration;
    const rows = await listInboxReferrals(config);
    expect(rows).toHaveLength(101);
    expect(rows.at(-1)?.id).toBe(oldUnhandled.id);
    expect(rows[0].receivedAt >= rows[1].receivedAt).toBe(true);
    expect(calls).toEqual([{ limit: 100 }, { status: "baru", limit: 100 }, { status: "dihubungi", limit: 100 }, { status: "diterima", limit: 100 }]);
  });

  it("updates a status and returns the stored row", async () => {
    const payload = validPayload();
    const stored: StoredReferral = { id: "00000000-0000-4000-8000-000000000001", reference: "RJ-20261116-ABCDEF12", receivedAt: "2026-11-16T02:30:00Z", status: "diterima", payload, note: "Datang", handledBy: "director", handledAt: "2026-11-16T03:00:00Z" };
    const { config, calls } = configWith({ update: { referral: stored } });
    const updated = await updateReferralStatus(config, { id: stored.id, status: "diterima", note: "Datang", actor: "director" });
    expect(updated.status).toBe("diterima");
    expect(calls[0].args).toEqual({ id: stored.id, status: "diterima", note: "Datang", actor: "director" });
  });
});
