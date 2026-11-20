"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { readLocal, writeLocal } from "./local-toast";
import { toast } from "@/components/ui/toast";
import { fromGap, openArahan } from "@/lib/instruction/instruction-prefill";

type GapRequest = { id: string; title: string; pic: string; context: string };
type GapStore = { resolved: Record<string, string>; open: (request: GapRequest) => void };
const GapContext = createContext<GapStore>({ resolved: {}, open: () => {} });

function detectPic(text: string): string {
  const lower = text.toLowerCase();
  if (lower.includes("dea") || lower.includes("sonia")) return "Ibu Dea / Ibu Sonia";
  if (lower.includes("oriza")) return "Ibu Oriza";
  if (lower.includes("aris")) return "Bapak Aris";
  if (lower.includes("jamila")) return "Ibu Jamila";
  if (lower.includes("dr. novi") || lower.includes("novia")) return "dr. Novia";
  return "Staf terkait";
}

/**
 * Client island: `[ISI]` placeholders in the brief can be filled by the Director while
 * waiting for the unit's report. The answer is a private browser note (keyed by report date);
 * it does not change the published brief and no reminder is sent from here.
 */
export function GapProvider({ date, children }: { date: string; children: ReactNode }) {
  const storageKey = `melinda_resolved_gaps_v2:${date}`;
  const [resolved, setResolved] = useState<Record<string, string>>({});
  const [active, setActive] = useState<GapRequest | null>(null);
  const [input, setInput] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => setResolved(readLocal<Record<string, string>>(storageKey) ?? {}), 0);
    return () => clearTimeout(timer);
  }, [storageKey]);

  function save() {
    if (!active || !input.trim()) return;
    const updated = { ...resolved, [active.id]: input.trim() };
    setResolved(updated);
    writeLocal(storageKey, updated);
    setActive(null);
    setInput("");
    toast.info("Catatan disimpan di browser ini", { description: "Catatan ini hanya tersimpan di browser ini, belum masuk laporan resmi." });
  }

  function askPic() {
    if (!active) return;
    if (openArahan({ context: "Brief harian", draft: fromGap(active, input) })) { setActive(null); setInput(""); return; }
    toast.warning("Panel arahan belum tersedia", { description: "Masuk sebagai Direktur untuk meminta data ke PIC lewat Katt." });
  }
  return (
    <GapContext.Provider value={{ resolved, open: (request) => { setActive(request); setInput(resolved[request.id] ?? ""); } }}>
      {children}
      {active && (
        <div role="dialog" aria-modal="true" aria-labelledby="gap-dialog-title" className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 animate-in fade-in duration-150">
          <div className="bg-white rounded-xl shadow-2xl border border-slate-200 max-w-lg w-full overflow-hidden animate-in zoom-in-95 duration-150">
            <div className="px-6 py-4 bg-slate-900 text-white flex justify-between items-center">
              <div>
                <span className="text-[10px] font-mono text-amber-400 font-bold block mb-0.5">Catatan data tertunda · hanya di browser ini</span>
                <h3 id="gap-dialog-title" className="text-base font-bold text-white m-0">{active.title}</h3>
              </div>
              <button type="button" onClick={() => setActive(null)} className="text-slate-400 hover:text-white p-1 rounded transition" aria-label="Tutup"><X size={18} /></button>
            </div>
            <div className="p-6 space-y-5">
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs">
                <span className="font-bold text-slate-700 block mb-1">Konteks laporan saat ini:</span>
                <p className="text-slate-600 m-0 leading-relaxed font-mono text-[11.5px]">&ldquo;{active.context}&rdquo;</p>
                <div className="mt-2 pt-2 border-t border-slate-200 flex items-center justify-between text-[11px]">
                  <span className="text-slate-500">Penanggung jawab:</span>
                  <span className="font-bold text-slate-800 bg-white px-2 py-0.5 rounded border border-slate-200">{active.pic}</span>
                </div>
              </div>
              <div className="space-y-2">
                <label htmlFor="gap-input" className="block text-xs font-bold text-slate-800">Tulis hasil konfirmasi</label>
                <div className="flex gap-2">
                  <input id="gap-input" type="text" value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") save(); }} placeholder="Contoh: Sudah disetujui Dinkes, SK terbit hari Senin" className="flex-1 px-3 py-2 bg-white border border-slate-300 rounded text-xs text-slate-900 focus:ring-2 focus:ring-slate-900 focus:outline-none" />
                  <button type="button" disabled={!input.trim()} onClick={save} className="px-4 py-2 bg-sky-700 hover:bg-sky-800 disabled:opacity-40 text-white rounded text-xs font-bold transition shadow-xs whitespace-nowrap active:scale-95">Simpan</button>
                </div>
                <span className="text-[10.5px] text-slate-500 block">Catatan ini hanya menggantikan tanda &ldquo;[ISI]&rdquo; di browser ini.</span>
              </div>
              <div className="border-t border-slate-200 pt-4 space-y-2">
                <p className="text-xs text-slate-600 m-0">Belum ada datanya? Minta penanggung jawab melengkapi lewat Katt (WhatsApp). Catatan di atas, bila diisi, ikut sebagai isi pesan.</p>
                <button type="button" onClick={askPic} className="director-instruction-link">Minta ke PIC via Katt</button>
              </div>
            </div>
            <div className="px-6 py-3 bg-slate-50 border-t border-slate-100 flex justify-end">
              <button type="button" onClick={() => setActive(null)} className="px-4 py-1.5 border border-slate-300 rounded text-xs font-semibold text-slate-600 hover:bg-slate-100 transition cursor-pointer">Tutup</button>
            </div>
          </div>
        </div>
      )}
    </GapContext.Provider>
  );
}

/** Renders text; an `[ISI]` placeholder becomes a button that opens the note dialog. */
export function GapText({ text, id, title, pic }: { text: string; id: string; title: string; pic?: string }) {
  const { resolved, open } = useContext(GapContext);
  if (!text.includes("[ISI]")) return <>{text}</>;
  const responsible = pic ?? detectPic(text);
  const request = { id, title, pic: responsible, context: text };
  if (resolved[id]) {
    return (
      <span className="inline-flex items-center gap-1.5 flex-wrap">
        <span className="font-semibold text-slate-900">{resolved[id]}</span>
        <span className="text-[10px] font-semibold text-sky-800">Catatan browser</span>
        <button type="button" onClick={() => open(request)} className="text-[10.5px] text-sky-700 hover:underline cursor-pointer font-medium ml-1">(Ubah)</button>
      </span>
    );
  }
  const parts = text.split("[ISI]");
  return (
    <span className="inline-flex items-baseline gap-1.5 flex-wrap">
      {parts[0]}
      <button type="button" onClick={() => open(request)} className="cursor-pointer font-medium text-[var(--orange-ink)] hover:underline" title="Klik untuk mencatat isi di browser ini">Menunggu laporan: {responsible}</button>
      {parts.slice(1).join("[ISI]")}
    </span>
  );
}
