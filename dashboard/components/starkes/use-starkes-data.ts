"use client";

import { useCallback, useEffect, useState } from "react";
import type { StarkesEvidence } from "@/lib/starkes/evidence-store";
import type { Kelulusan } from "@/lib/starkes/kelulusan-rules";
import type { DirectorScore } from "@/lib/starkes/readiness";
import type { OfficialRequirement } from "@/lib/starkes/requirements";

export type StarkesPayload = { requirements: OfficialRequirement[]; scores: DirectorScore[]; evidence: StarkesEvidence[]; rules: Kelulusan };

const LOAD_ERROR = "Data STARKES belum dapat dimuat. Muat ulang halaman.";

async function fetchPayload(): Promise<StarkesPayload> {
  const response = await fetch("/api/starkes/readiness", { cache: "no-store" });
  if (!response.ok) throw new Error(String(response.status));
  return response.json();
}

/** One GET for register, Director audit scores, evidence and pass/fail rules; `reload` after any write. */
export function useStarkesData(initial?: StarkesPayload) {
  const [data, setData] = useState<StarkesPayload | null>(initial ?? null);
  const [error, setError] = useState("");
  const reload = useCallback(() => fetchPayload().then((payload) => { setData(payload); setError(""); }, () => setError(LOAD_ERROR)), []);
  useEffect(() => {
    if (initial) return;
    let live = true;
    fetchPayload().then((payload) => { if (live) setData(payload); }, () => { if (live) setError(LOAD_ERROR); });
    return () => { live = false; };
  }, [initial]);
  return { data, error, reload };
}
