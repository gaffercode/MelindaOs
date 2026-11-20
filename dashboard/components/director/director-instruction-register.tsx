import Link from "next/link";
import { authConfiguration } from "@/lib/director/director-auth";
import { longDate, wibTime } from "@/lib/director/director-data";
import { actionLabels, sectionLabels, statusLabels, type Instruction } from "@/lib/director/director-instructions";
import { LINKED_IDS_MAX, OPEN_WINDOW_DEFAULT_DAYS, openInstructions } from "@/lib/director/director-instructions-api";
import { logError } from "@/lib/log";
import { DirectorInstruction, InstructionBlockedStatus, InstructionProvider } from "./director-instruction";
import { DirectorNewInstruction } from "./director-new-instruction";
import { SourceInfo } from "../source-info";

/*
 * Server component: every instruction the Director is still waiting on, in one table. Overdue rows come
 * first and their deadline is red-orange text; nothing else is coloured. Each row carries the same
 * "Beri arahan" island as the brief, so the Director can press again or close the item from here.
 */

const warn = "text-[color:var(--warn)]";
const delivered = new Set<Instruction["status"]>(["terkirim_ke_grokbot", "diteruskan", "diterima_pic", "dikerjakan"]);

/** `?hari=` from the URL: 1–31, otherwise the default window. */
export function registerDays(value: unknown): number {
  return typeof value === "string" && /^\d{1,2}$/.test(value) && Number(value) >= 1 && Number(value) <= 31 ? Number(value) : OPEN_WINDOW_DEFAULT_DAYS;
}

export function deadlineLabel(deadline: string): string {
  return `${longDate(deadline.slice(0, 10))} ${deadline.slice(11, 16).replace(":", ".")} WIB`;
}

export function overdue(instruction: Instruction, nowWib: string): boolean {
  return Boolean(instruction.deadline) && delivered.has(instruction.status) && (instruction.deadline as string) < nowWib;
}

export function sortRegister(instructions: Instruction[], nowWib: string): Instruction[] {
  return [...instructions].sort((a, b) => Number(overdue(b, nowWib)) - Number(overdue(a, nowWib)) || a.reportDate.localeCompare(b.reportDate) || a.createdAt.localeCompare(b.createdAt));
}

export async function DirectorInstructionRegister({ today, days, now = new Date() }: { today: string; days: number; now?: Date }) {
  let config;
  try { config = authConfiguration(); } catch (error) { logError("register_configuration", error); config = null; }
  if (!config) {
    return <p role="status" className="director-notice">Daftar arahan membaca buku besar di Supabase, jadi hanya tersedia dalam mode terlindung. Mode file lokal tidak menyimpan arahan.</p>;
  }
  let open: Instruction[];
  try { ({ instructions: open } = await openInstructions(config, today, days)); } catch (error) {
    logError("register_read", error);
    return <p role="status" className="director-notice director-error">Daftar arahan belum dapat dibaca dari penyimpanan. Muat ulang halaman.</p>;
  }
  const nowWib = `${today}T${wibTime(now.toISOString()).slice(0, 5)}`;
  const rows = sortRegister(open, nowWib);
  const late = rows.filter((row) => overdue(row, nowWib)).length;
  return (
    <InstructionProvider date={today} linkedIds={rows.slice(0, LINKED_IDS_MAX).map((row) => row.id)}>
      <DirectorNewInstruction date={today} />
      <section className="swiss-section mt-8" aria-labelledby="arahan-terbuka">
        <div className="flex justify-between items-baseline gap-3 border-b border-slate-200 pb-3 mb-4">
          <h2 id="arahan-terbuka" className="swiss-section-heading">Arahan yang belum selesai</h2>
          <span className={`melinda-section-meta ${late ? warn : "text-slate-500"}`}>{rows.length} arahan{late ? `, ${late} lewat tenggat` : ""}</span>
        </div>
        {rows.length === 0 ? <p className="director-empty">Tidak ada arahan terbuka dalam {days} hari terakhir.</p> : (
          <div className="swiss-table-wrap">
            <table className="swiss-table register-table">
              <thead>
                <tr>
                  <th scope="col" className="text-left w-24 whitespace-nowrap">Nomor</th>
                  <th scope="col" className="text-left w-28 whitespace-nowrap">Tanggal</th>
                  <th scope="col" className="text-left">Perihal</th>
                  <th scope="col" className="text-left w-36">Arahan</th>
                  <th scope="col" className="text-left w-48">PIC</th>
                  <th scope="col" className="text-left w-44">Tenggat</th>
                  <th scope="col" className="text-left w-36">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const late = overdue(row, nowWib);
                  return (
                    <tr key={row.id} data-overdue={late || undefined}>
                      <td className="text-left font-mono text-slate-800 whitespace-nowrap">{row.id}</td>
                      <td className="text-left whitespace-nowrap"><Link href={row.section === "umum" ? "/arahan" : `/?tanggal=${row.reportDate}`} prefetch={false} className="text-[var(--accent)] hover:underline">{row.reportDate}</Link></td>
                      <td className="text-left text-slate-900">
                        <span className="text-slate-500">{sectionLabels[row.section]}{row.urgent ? " · mendesak" : ""}: </span>{row.itemTitle}
                        {row.note && <p className="m-0 mt-1 text-slate-600">{row.note}</p>}
                        {/* Keyed on the IOC id, not the brief's per-date item id, so a re-instruction never shows under today's unrelated FU-n. */}
                        <DirectorInstruction date={today} section={row.section} item={{ id: row.id, title: row.itemTitle, urgent: row.urgent }} linkedId={row.id} />
                      </td>
                      <td className="text-left">{actionLabels[row.action]}{row.decisionLabel ? ` — ${row.decisionLabel}` : ""}</td>
                      <td className="text-left text-slate-700">{row.pic.length ? row.pic.join(", ") : "Grup default"}</td>
                      <td className={late ? `text-left ${warn}` : "text-left text-slate-700"}>{row.deadline ? deadlineLabel(row.deadline) : "—"}</td>
                      <td className="text-left text-slate-700">{row.status === "terkendala" ? <InstructionBlockedStatus history={row.history} /> : statusLabels[row.status]}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="mt-3"><SourceInfo><p className="m-0 text-slate-700">Buku besar arahan di Supabase, dibaca {wibTime(now.toISOString())} untuk {days} hari sampai {longDate(today)}. Arahan selesai dan yang Direktur tandai selesai tidak ditampilkan.</p></SourceInfo></div>
      </section>
    </InstructionProvider>
  );
}
