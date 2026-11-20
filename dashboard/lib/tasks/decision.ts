import { fail, record, str } from "./contract";

export const decisionKinds = ["putuskan", "alihkan", "tunda", "batal", "selesai", "hubungi_saya"] as const;
export type DecisionKind = typeof decisionKinds[number];
export type Decision = { kind: DecisionKind; note?: string; pic?: string[] };

/** Parses the body of `POST /api/director/tasks/[id]/decision`; every failure is a `ContractError`. */
export function parseDecision(value: unknown): Decision {
  const input = record(value, ["kind", "note", "pic"], "Keputusan");
  const kind = typeof input.kind === "string" && (decisionKinds as readonly string[]).includes(input.kind) ? input.kind as DecisionKind : fail("Jenis keputusan tidak dikenal.");
  const note = input.note == null || input.note === "" ? undefined : str(input.note, 0, 280, "Catatan") || undefined;
  if (kind === "putuskan" && !note) return fail("Catatan keputusan wajib diisi.");
  if (input.pic != null && kind !== "alihkan") return fail("PIC hanya untuk Alihkan.");
  if (kind !== "alihkan") return { kind, ...(note ? { note } : {}) };
  if (!Array.isArray(input.pic) || input.pic.length < 1 || input.pic.length > 8) return fail("PIC wajib diisi (1-8 nama).");
  const pic = [...new Set(input.pic.map((name) => str(name, 1, 60, "PIC")))];
  return { kind, pic, ...(note ? { note } : {}) };
}
