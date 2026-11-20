"use client";

import { useEffect, useState, type FormEvent } from "react";
import { LoadingState } from "./loading-state";

type UnitSource = { id: string; label: string; numericFields: { key: string; label: string; minimum: number }[] };

export function capabilityFromHash(hash: string): string | null {
  const match = /^#capability=([A-Za-z0-9_-]{43})$/.exec(hash);
  return match?.[1] ?? null;
}
export function sessionRequestForHash(hash: string): { method: "GET" | "POST"; headers?: Record<string, string>; body?: string } {
  const capability = capabilityFromHash(hash);
  return capability ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ capability }) } : { method: "GET" };
}
export function nextIssuesForAvailability(current: string, availability: string): string {
  if (availability === "received" && current === "Tidak ada kendala") return "";
  if (availability === "no_issues" && !current) return "Tidak ada kendala";
  return current;
}

export function UnitReportForm({ reportDate, source }: { reportDate: string; source: UnitSource }) {
  const [availability, setAvailability] = useState("no_issues");
  const [issues, setIssues] = useState("Tidak ada kendala"), [followUp, setFollowUp] = useState(""), [decisionNeeded, setDecisionNeeded] = useState("");
  const [metrics, setMetrics] = useState<Record<string, string>>({}), [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage("");
    const numeric = Object.fromEntries(Object.entries(metrics).filter(([, value]) => value !== "").map(([key, value]) => [key, Number(value)]));
    try {
      const response = await fetch("/api/unit-reports", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ availability, issues, followUp, decisionNeeded, metrics: numeric }) });
      const body = await response.json().catch(() => ({})) as { error?: string; revision?: number };
      if (!response.ok) throw new Error(body.error ?? "Laporan belum dapat dikirim.");
      setMessage(`Laporan diterima. Revisi ${body.revision ?? 1}.`);
    } catch (error) { setMessage((error as Error).message); } finally { setBusy(false); }
  }
  return <form className="unit-report-form" onSubmit={submit}>
    <header><p className="unit-report-kicker">Laporan unit · {reportDate}</p><h1>{source.label}</h1><p>Isi ringkas tanpa nama pasien, nomor rekam medis, atau identitas pribadi.</p></header>
    <label><span>Status laporan</span><select value={availability} onChange={(event) => { const value = event.target.value; setAvailability(value); setIssues((current) => nextIssuesForAvailability(current, value)); }}><option value="no_issues">Tidak ada kendala</option><option value="received">Ada informasi untuk dilaporkan</option><option value="unavailable">Data belum tersedia</option></select></label>
    <label><span>Masalah atau kendala</span><textarea value={issues} maxLength={2000} onChange={(event) => setIssues(event.target.value)} /></label>
    <label><span>Tindak lanjut</span><textarea value={followUp} maxLength={2000} onChange={(event) => setFollowUp(event.target.value)} /></label>
    <label><span>Butuh keputusan Direktur</span><textarea value={decisionNeeded} maxLength={2000} onChange={(event) => setDecisionNeeded(event.target.value)} /></label>
    {source.numericFields.map((field) => <label key={field.key}><span>{field.label}</span><input type="number" min={field.minimum} value={metrics[field.key] ?? ""} onChange={(event) => setMetrics((current) => ({ ...current, [field.key]: event.target.value }))} /></label>)}
    <button className="director-button" disabled={busy} type="submit">{busy ? "Mengirim…" : "Kirim laporan"}</button>
    {message && <p className="unit-report-message" role="status">{message}</p>}
  </form>;
}

export function UnitReportEntry() {
  const [state, setState] = useState<{ reportDate: string; source: UnitSource } | { error: string } | null>(null);
  useEffect(() => {
    const request = sessionRequestForHash(window.location.hash);
    const controller = new AbortController();
    fetch("/api/unit-reports/session", { ...request, signal: controller.signal })
      .then(async (response) => { const body = await response.json(); if (!response.ok) throw new Error(body.error ?? "Tautan laporan tidak berlaku."); return body; })
      .then((body) => { if (request.method === "POST") window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`); setState(body); })
      .catch((error: Error) => { if (!controller.signal.aborted) setState({ error: error.message }); });
    return () => controller.abort();
  }, []);
  if (!state) return <p className="unit-report-loading"><LoadingState label="Memeriksa tautan laporan" /></p>;
  if ("error" in state) return <p className="unit-report-error" role="alert">{state.error}</p>;
  return <UnitReportForm {...state} />;
}
