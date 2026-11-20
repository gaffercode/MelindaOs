"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import type { MelindaEmailTriageAccount } from "@/lib/melinda/melinda-brief-data";
import { fetchMarks, missingOnServer, saveMarks } from "../marks-client";
import { readJson } from "../tasks/board-client";
import { sessionResponse } from "@/lib/client-api";
import { readLocal, writeLocal } from "./local-toast";

type Handling = "belum" | "destri" | "eskalasi";
const HANDLING_VALUES: Handling[] = ["belum", "destri", "eskalasi"];
const asHandling = (value: unknown): Handling | undefined => HANDLING_VALUES.find((candidate) => candidate === value);
// Mirrors `validMailbox` in lib/director/director-marks-api.ts (server code, so not imported): one refused item makes the server refuse the whole upload.
const acceptedByServer = (akun: string): boolean => akun.length >= 3 && akun.length <= 120 && akun === akun.trim() && !akun.split("").some((character) => character.charCodeAt(0) < 0x20 || character.charCodeAt(0) === 0x7f) && /melinda/i.test(akun);

const HANDLING: Record<Handling, { label: string; bg: string; text: string; border: string; dot: string }> = {
  belum: { label: "Belum ditangani", bg: "bg-slate-100/90 hover:bg-white", text: "text-slate-700", border: "border-slate-300", dot: "bg-slate-400" },
  destri: { label: "Ditangani Destri", bg: "bg-sky-50 hover:bg-sky-100/70", text: "text-sky-900", border: "border-sky-300", dot: "bg-sky-600" },
  eskalasi: { label: "Perlu eskalasi", bg: "bg-rose-50 hover:bg-rose-100/70", text: "text-rose-800", border: "border-rose-300", dot: "bg-rose-500" },
};

/** Only the hospital's mailboxes belong on the Director's sheet (Director 2026-11-09): hai@melinda.co.id and the
 * Yahoo Melinda box. Personal, family and Sentra boxes in the published brief stay out of the table. */
export function hospitalAccounts(accounts: MelindaEmailTriageAccount[]): MelindaEmailTriageAccount[] {
  return accounts.filter((account) => /melinda/i.test(account.akun));
}

/**
 * Client island: who handles each mailbox (the Asuransi & Penjaminan officer) is the Director's working note.
 * It is saved on the server, keyed by report date and mailbox, so it follows the Director across devices. This browser
 * keeps a copy that shows at once and still works when the server cannot be reached.
 * When both have a value, the server's wins. A value only the browser has is uploaded when the table loads.
 */
export function EmailTriageTable({ date, accounts }: { date: string; accounts: MelindaEmailTriageAccount[] }) {
  const shown = useMemo(() => hospitalAccounts(accounts), [accounts]);
  const hasHospital = shown.length > 0;
  const key = `melinda_email_handling_v1:${date}`;
  const [handling, setHandling] = useState<Record<string, Handling>>({});
  const [saveFailed, setSaveFailed] = useState(false);
  // The session token being fetched for this date. A change made before it arrives waits for it, then saves.
  const csrfToken = useRef<Promise<string>>(Promise.resolve(""));
  // Mailboxes the Director changed in this page, so a slow marks read cannot put an older server value over them.
  const changed = useRef(new Set<string>());
  // Counts saves; only the latest one may set the unsaved line, and a new date makes every earlier save stale.
  const saves = useRef(0);

  useEffect(() => {
    if (!hasHospital) return;
    changed.current.clear();
    const controller = new AbortController();
    const { signal } = controller;
    const stored = (): Record<string, Handling> => {
      const valid: Record<string, Handling> = {};
      for (const [akun, value] of Object.entries(readLocal<Record<string, unknown>>(key) ?? {})) { const known = asHandling(value); if (known) valid[akun] = known; }
      return valid;
    };
    // Neither read hides the table: a failed session read means "cannot save", a failed marks read means "no server data".
    const token = sessionResponse(signal).then((response) => readJson<{ csrfToken: string }>(response)).then((session) => session.csrfToken || "", () => "");
    csrfToken.current = token;
    const load = async () => {
      const server = await fetchMarks("email_handling", { date, signal }).catch(() => null);
      const uploadToken = await token;
      if (signal.aborted || !server) return;
      const local = stored();
      const serverValues = new Map(server.map((mark) => [mark.key, asHandling(mark.value)]));
      const merged = { ...local };
      // Only a value somebody chose is kept: the "belum" shown for a mailbox without one is not cached, or the next load would upload it.
      for (const { akun } of shown) {
        const chosen = serverValues.get(akun) ?? local[akun];
        if (!changed.current.has(akun) && chosen) merged[akun] = chosen;
      }
      setHandling(merged);
      writeLocal(key, merged);
      const browserOnly = missingOnServer(shown.flatMap(({ akun }) => (local[akun] && !changed.current.has(akun) && acceptedByServer(akun) ? [{ key: akun, value: local[akun] }] : [])), server);
      if (uploadToken && browserOnly.length > 0) saveMarks("email_handling", browserOnly, uploadToken, date).catch(() => {});
    };
    const timer = setTimeout(() => { setHandling(stored()); setSaveFailed(false); void load(); }, 0);
    // Leaving this date (or the page) makes every save still waiting stale: it sets nothing.
    return () => { clearTimeout(timer); controller.abort(); saves.current += 1; };
  }, [key, date, hasHospital, shown]);

  function update(akun: string, value: Handling) {
    const next = { ...handling, [akun]: value };
    changed.current.add(akun);
    setHandling(next);
    writeLocal(key, next);
    saves.current += 1;
    const turn = saves.current;
    const saved = csrfToken.current.then((csrf) => (csrf ? saveMarks("email_handling", [{ key: akun, value }], csrf, date).then(() => true, () => false) : false));
    void saved.then((ok) => { if (turn === saves.current) setSaveFailed(!ok); });
  }

  if (!hasHospital) return <p className="text-slate-700 leading-relaxed m-0">Tidak ada kotak surat rumah sakit dalam brief ini.</p>;
  const total = shown.reduce((sum, account) => ({ total: sum.total + account.total, perluTindakan: sum.perluTindakan + account.perluTindakan, fyi: sum.fyi + account.fyi, promoOtomatis: sum.promoOtomatis + account.promoOtomatis }), { total: 0, perluTindakan: 0, fyi: 0, promoOtomatis: 0 });

  return (
    <>
    <div className="swiss-table-wrap">
      <table className="swiss-table">
        <thead>
          <tr>
            <th scope="col" className="text-left w-[34%]">Akun</th>
            <th scope="col" className="text-center w-20 whitespace-nowrap">Total</th>
            <th scope="col" className="text-center w-32 whitespace-nowrap">Perlu tindakan</th>
            <th scope="col" className="text-center w-20 whitespace-nowrap">Info</th>
            <th scope="col" className="text-center w-36 whitespace-nowrap">Promo / otomatis</th>
            <th scope="col" className="text-left w-44 whitespace-nowrap">Penanganan</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((account) => {
            const current = handling[account.akun] ?? "belum";
            const config = HANDLING[current];
            return (
              <tr key={account.akun}>
                <td className="text-left font-mono text-slate-800">{account.akun}</td>
                <td className="text-center font-mono">{account.total}</td>
                <td className="text-center font-mono font-semibold text-slate-700">{account.perluTindakan}</td>
                <td className="text-center font-mono">{account.fyi}</td>
                <td className="text-center font-mono text-slate-500">{account.promoOtomatis}</td>
                <td className="text-left whitespace-nowrap">
                  <div className={`relative inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border text-[11px] font-semibold transition-[background-color,border-color,color,box-shadow,transform] duration-200 ease-out shadow-2xs group hover:shadow-xs hover:-translate-y-px has-[:active]:translate-y-0 has-[:active]:scale-[0.96] has-[:active]:shadow-none motion-reduce:transition-none motion-reduce:transform-none has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-slate-400 has-[:focus-visible]:ring-offset-1 ${config.bg} ${config.text} ${config.border}`} title="Klik untuk ubah penanganan">
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${config.dot}`} />
                    <span>{config.label}</span>
                    <ChevronDown size={11} className="opacity-50 group-hover:opacity-80 transition-opacity shrink-0 ml-0.5" />
                    <select value={current} onChange={(event) => update(account.akun, event.target.value as Handling)} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" aria-label={`Ubah penanganan: ${account.akun}`}>
                      <option value="belum">Belum ditangani</option>
                      <option value="destri">Ditangani Destri</option>
                      <option value="eskalasi">Perlu eskalasi</option>
                    </select>
                  </div>
                </td>
              </tr>
            );
          })}
          <tr className="swiss-total-row">
            <th scope="row" className="text-left font-medium">Total</th>
            <td className="text-center font-mono font-medium">{total.total}</td>
            <td className="text-center font-mono font-medium">{total.perluTindakan}</td>
            <td className="text-center font-mono font-medium">{total.fyi}</td>
            <td className="text-center font-mono font-medium">{total.promoOtomatis}</td>
            <td />
          </tr>
        </tbody>
      </table>
    </div>
    {saveFailed && <p role="status" className="text-xs text-slate-600 m-0 mt-2">Status belum tersimpan ke server.</p>}
    </>
  );
}
