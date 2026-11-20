"use client";

import { AiStatus, type AiStatusStateConfig } from "@/components/ui/ai-status";
import { cn } from "@/lib/utils";

export type AiActivityState = "thinking" | "researching" | "analyzing" | "writing" | "done" | "error";

/** Indonesian labels for Rare UI's AiStatus; the elapsed time comes from the component's own run timer. */
const STATES: Record<AiActivityState, AiStatusStateConfig> = {
  thinking: { label: "Berpikir", active: true },
  researching: { label: "Mencari di dokumen MelindaOS", active: true },
  analyzing: { label: "Menganalisis", active: true },
  writing: { label: "Menulis", active: true },
  done: { label: (elapsed) => (elapsed ? `Selesai dalam ${elapsed}` : "Selesai"), active: false },
  error: { label: (elapsed) => (elapsed ? `Gagal setelah ${elapsed}` : "Gagal"), active: false },
};

/**
 * Status line for a real AI call (Tanya Melinda, ringkasan arahan, polish catatan). The state follows the request:
 * an active state while the fetch is in flight, `done` or `error` once it settles. Never shown without a request.
 */
export function AiActivity({ state, label, detail, className }: { state: AiActivityState; label?: string; detail?: string; className?: string }) {
  return <AiStatus state={state} states={STATES} label={label} detail={detail} className={cn("text-[length:var(--type-body)] text-[var(--color-text-primary)]", className)} />;
}
