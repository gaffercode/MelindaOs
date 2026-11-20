"use client";

import { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
import type { MelindaScheduleEntry } from "@/lib/melinda/melinda-brief-data";
import { readLocal, writeLocal } from "./local-toast";
import { toast } from "@/components/ui/toast";
import { fromSchedule, openArahan } from "@/lib/instruction/instruction-prefill";

type ScheduleStatusType = "selesai" | "berjalan" | "menunggu" | "tunda";

const STATUS: Record<ScheduleStatusType, { label: string; bg: string; text: string; border: string; dot: string }> = {
  menunggu: { label: "Menunggu", bg: "bg-slate-100/90 hover:bg-white", text: "text-slate-700", border: "border-slate-300", dot: "bg-slate-400" },
  berjalan: { label: "Sedang berjalan", bg: "bg-amber-50 hover:bg-amber-100/70", text: "text-amber-900", border: "border-amber-300", dot: "bg-amber-500" },
  selesai: { label: "Selesai", bg: "bg-sky-50 hover:bg-sky-100/70", text: "text-sky-900", border: "border-sky-300", dot: "bg-sky-600" },
  tunda: { label: "Ditunda", bg: "bg-rose-50 hover:bg-rose-100/70", text: "text-rose-800", border: "border-rose-300", dot: "bg-rose-500" },
};

/** Browser-note keys for one schedule source. Dash rows use scope `dash`, so they never share keys with brief rows. */
export function scheduleStorageKeys(date: string, scope?: string) {
  const suffix = scope ? `:${scope}` : "";
  return { statusKey: `melinda_schedule_status_v3:${date}${suffix}`, remarkKey: `melinda_schedule_remarks_v2:${date}${suffix}` };
}

/**
 * Client island: agenda status and remarks are a Director's private working notes.
 * They stay in this browser (keyed by report date) and never reach a server.
 */
export function ScheduleTable({ date, items, scope }: { date: string; items: MelindaScheduleEntry[]; scope?: string }) {
  const { statusKey, remarkKey } = scheduleStorageKeys(date, scope);
  const [statuses, setStatuses] = useState<Record<number, ScheduleStatusType>>({});
  const [remarks, setRemarks] = useState<Record<number, string>>({});

  useEffect(() => {
    const timer = setTimeout(() => {
      setStatuses(readLocal<Record<number, ScheduleStatusType>>(statusKey) ?? {});
      setRemarks(readLocal<Record<number, string>>(remarkKey) ?? {});
    }, 0);
    return () => clearTimeout(timer);
  }, [statusKey, remarkKey]);

  function updateStatus(index: number, status: ScheduleStatusType) {
    const updated = { ...statuses, [index]: status };
    setStatuses(updated);
    writeLocal(statusKey, updated);
    const item = items[index];
    if (status === "tunda") toast.info(`Agenda ditunda: "${item.kegiatan}"`, { description: "Status ini hanya tersimpan di browser ini." });
    if (status === "selesai") toast.info(`Agenda selesai: "${item.kegiatan}"`, { description: "Status ini hanya tersimpan di browser ini." });
  }
  function forward(index: number) {
    const row = items[index];
    const handled = openArahan({ context: "Jadwal hari ini", draft: fromSchedule(row, statuses[index] ?? "menunggu", remarks[index] ?? "") });
    if (!handled) toast.warning("Panel arahan belum tersedia", { description: "Masuk sebagai Direktur untuk meneruskan agenda ke staf." });
  }
  function updateRemark(index: number, remark: string) {
    const updated = { ...remarks, [index]: remark };
    setRemarks(updated);
    writeLocal(remarkKey, updated);
  }

  return (
    <div className="swiss-table-wrap schedule-table-wrap">
      <table className="swiss-table schedule-table">
        <thead>
          <tr>
            <th scope="col" className="text-left w-[13%] whitespace-nowrap">Status</th>
            <th scope="col" className="text-left w-[11%] whitespace-nowrap">Waktu</th>
            <th scope="col" className="text-left w-[24%]">Kegiatan</th>
            <th scope="col" className="text-left w-[16%]">Siapa</th>
            <th scope="col" className="text-left w-[21%]">Topik tindak lanjut / bahan</th>
            <th scope="col" className="text-left w-[15%]">Remark (catatan hasil)</th>
          </tr>
        </thead>
        <tbody>
          {items.map((row, index) => {
            const current = statuses[index] ?? "menunggu";
            const config = STATUS[current];
            const rowClass = current === "selesai" ? "opacity-60 bg-slate-50/50" : current === "berjalan" ? "bg-amber-50/60 font-medium" : current === "tunda" ? "bg-rose-50/30" : undefined;
            return (
              <tr key={index} className={rowClass}>
                <td className="text-left whitespace-nowrap">
                  <div className={`relative inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border text-[11px] font-semibold transition-[background-color,border-color,color,box-shadow,transform] duration-200 ease-out shadow-2xs group hover:shadow-xs hover:-translate-y-px has-[:active]:translate-y-0 has-[:active]:scale-[0.96] has-[:active]:shadow-none motion-reduce:transition-none motion-reduce:transform-none has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-slate-400 has-[:focus-visible]:ring-offset-1 ${config.bg} ${config.text} ${config.border}`} title="Klik untuk ubah status agenda">
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${config.dot}`} />
                    <span>{config.label}</span>
                    <ChevronDown size={11} className="opacity-50 group-hover:opacity-80 transition-opacity shrink-0 ml-0.5" />
                    <select value={current} onChange={(event) => updateStatus(index, event.target.value as ScheduleStatusType)} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" aria-label={`Ubah status agenda: ${row.kegiatan}`}>
                      <option value="menunggu">Menunggu</option>
                      <option value="berjalan">Sedang berjalan</option>
                      <option value="selesai">Selesai</option>
                      <option value="tunda">Ditunda</option>
                    </select>
                  </div>
                </td>
                <td className="text-left font-mono font-semibold whitespace-nowrap text-slate-700 text-xs">{row.waktu}</td>
                <td className="text-left text-xs leading-snug"><span className={current === "selesai" ? "text-slate-500 font-normal" : "font-medium text-slate-900"}>{row.kegiatan}</span></td>
                <td className="text-left text-xs text-slate-700 leading-snug">{row.siapa}</td>
                <td className="text-left text-xs text-slate-700 leading-snug">{row.topikTindakLanjut}</td>
                <td className="text-left min-w-0">
                  <input type="text" value={remarks[index] ?? ""} onChange={(event) => updateRemark(index, event.target.value)} placeholder="Tulis catatan..." title="Tulis hasil agenda di sini (hanya tersimpan di browser ini)" aria-label={`Hasil agenda: ${row.kegiatan}`} className="w-full min-w-0 px-2 py-1 bg-slate-50/80 hover:bg-white focus:bg-white border border-slate-200 focus:border-slate-400 rounded text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400 transition" />
                  <button type="button" className="director-instruction-link schedule-forward" aria-label={`Teruskan ke staf: ${row.kegiatan}`} onClick={() => forward(index)}>Teruskan ke staf</button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
