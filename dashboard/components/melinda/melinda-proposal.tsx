"use client";

import { Check, X } from "lucide-react";
import { useState } from "react";
import { directorCsrfHeaders } from "@/lib/client-api";
import type { ActionProposal } from "@/lib/melinda/actions";

type State = { phase: "pending" | "sending" | "done"; message: string | null; ok: boolean };

const KIND_LABEL: Record<ActionProposal["kind"], string> = {
  ganti_pic: "Ganti PIC",
  status_tugas: "Status tugas",
  tindak_lanjut: "Tindak lanjut",
  tugas_baru: "Tugas baru",
  sinkron: "Sinkronisasi",
  ubah_jadwal: "Perubahan jadwal",
};

const errorOf = (value: unknown) => (typeof value === "object" && value !== null && "error" in value && typeof value.error === "string" ? value.error : "Keputusan belum terkirim. Coba lagi.");
const messageOf = (value: unknown) => (typeof value === "object" && value !== null && "message" in value && typeof value.message === "string" ? value.message : "Selesai.");

/** One change Melinda prepared. Nothing is written until the Director presses Konfirmasi here. */
export function MelindaProposal({ proposal }: { proposal: ActionProposal }) {
  const [state, setState] = useState<State>({ phase: "pending", message: null, ok: false });

  async function decide(decision: "confirm" | "cancel") {
    setState({ phase: "sending", message: null, ok: false });
    try {
      const response = await fetch(`/api/melinda/actions/${encodeURIComponent(proposal.id)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await directorCsrfHeaders()) },
        body: JSON.stringify({ decision }),
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) { setState({ phase: response.status === 409 || response.status === 404 ? "done" : "pending", message: errorOf(body), ok: false }); return; }
      const status = typeof body === "object" && body !== null && "status" in body ? body.status : null;
      setState({ phase: "done", message: messageOf(body), ok: status === "executed" });
    } catch {
      setState({ phase: "pending", message: "Keputusan belum terkirim. Coba lagi.", ok: false });
    }
  }

  return <section className="melinda-proposal" aria-label={`Usulan: ${KIND_LABEL[proposal.kind]}`}>
    <p className="melinda-proposal-kind">{KIND_LABEL[proposal.kind]} · menunggu konfirmasi</p>
    <p className="melinda-proposal-summary">{proposal.summary}</p>
    {state.phase !== "done" && <div className="melinda-proposal-actions">
      <button type="button" className="melinda-proposal-confirm" disabled={state.phase === "sending"} onClick={() => void decide("confirm")}><Check className="size-4" aria-hidden="true" />Konfirmasi</button>
      <button type="button" className="melinda-proposal-cancel" disabled={state.phase === "sending"} onClick={() => void decide("cancel")}><X className="size-4" aria-hidden="true" />Batal</button>
    </div>}
    {state.message && <p role={state.ok ? "status" : "alert"} className={state.ok ? "melinda-proposal-result" : "melinda-proposal-result text-[var(--warn)]"}>{state.message}</p>}
  </section>;
}
