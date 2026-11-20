"use client";

import { createContext, useContext, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { AiActivity } from "../ai-activity";
import { toast } from "@/components/ui/toast";
import { actionLabels, deadlineActions, instructionActions, latestHistoryNote, messageText, statusLabels, type Instruction, type InstructionAction, type InstructionInput, type InstructionSection } from "@/lib/director/director-instructions";
import { LoadingState } from "../loading-state";
import { sessionResponse } from "@/lib/client-api";

type Store = { state: "loading" | "ready" | "unavailable"; message: string; csrf: string; instructions: Instruction[]; officials: string[]; save: (instruction: Instruction) => void; close: (id: string) => void };
const InstructionContext = createContext<Store>({ state: "loading", message: "", csrf: "", instructions: [], officials: [], save: () => {}, close: () => {} });

async function readJson<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? "Layanan arahan belum tersedia.");
  return body;
}

/** `linkedIds`: instructions from other dates that this brief carries forward (follow-ups with `instructionId`). */
export function InstructionProvider({ date, linkedIds = [], children }: { date: string; linkedIds?: string[]; children: ReactNode }) {
  const [store, setStore] = useState<Omit<Store, "save" | "close">>({ state: "loading", message: "", csrf: "", instructions: [], officials: [] });
  const linked = linkedIds.join(",");
  useEffect(() => {
    const controller = new AbortController();
    const query = new URLSearchParams({ tanggal: date });
    for (const id of linked ? linked.split(",") : []) query.append("id", id);
    (async () => {
      const [session, list] = await Promise.all([
        sessionResponse(controller.signal).then(readJson<{ csrfToken: string }>),
        fetch(`/api/director/instructions?${query}`, { cache: "no-store", signal: controller.signal }).then(readJson<{ instructions: Instruction[]; officials?: string[] }>),
      ]);
      setStore({ state: "ready", message: "", csrf: session.csrfToken, instructions: list.instructions, officials: list.officials ?? [] });
    })().catch((error: Error) => { if (!controller.signal.aborted) setStore((current) => ({ ...current, state: "unavailable", message: error.message })); });
    return () => controller.abort();
  }, [date, linked]);
  const save = (instruction: Instruction) => setStore((current) => ({ ...current, instructions: [...current.instructions.filter((item) => item.id !== instruction.id), instruction] }));
  // Mirrors the server closing a linked instruction on "done", including one still `dibuat` or `gagal`. A reload shows the ledger's own answer.
  const close = (id: string) => setStore((current) => ({ ...current, instructions: current.instructions.map((item) => item.id === id && item.status !== "selesai" ? { ...item, status: "selesai" } : item) }));
  return <InstructionContext.Provider value={{ ...store, save, close }}>{children}</InstructionContext.Provider>;
}

/** The instruction store (session CSRF, officials, ledger rows) for components inside an InstructionProvider. */
export function useInstructionStore(): Store { return useContext(InstructionContext); }

export function InstructionBlockedStatus({ history }: { history: Instruction["history"] }) {
  const note = latestHistoryNote(history);
  return <span className="instruction-blocked">Terkendala{note ? ` · ${note}` : ""}</span>;
}

/** `linkedId`: the earlier instruction this item carries; its status shows until a new instruction is given on the item. */
export function DirectorInstruction({ date, section, item, decisionOptions = [], linkedId }: {
  date: string; section: InstructionSection; item: { id: string; title: string; urgent?: boolean };
  decisionOptions?: { id: string; label: string }[]; linkedId?: string;
}) {
  const store = useContext(InstructionContext);
  const [open, setOpen] = useState(false), [preview, setPreview] = useState(false), [busy, setBusy] = useState(false), [polishing, setPolishing] = useState(false), [error, setError] = useState("");
  const [aiRun, setAiRun] = useState<"idle" | "writing" | "done" | "error">("idle");
  const [action, setAction] = useState<InstructionAction>("request_update"), [deadline, setDeadline] = useState(""), [pic, setPic] = useState<string[]>([]), [note, setNote] = useState(""), [option, setOption] = useState("");
  const operation = useRef<{ signature: string; key: string } | null>(null);
  const pics = store.officials;
  const latest = store.instructions.filter((instruction) => instruction.section === section && instruction.itemId === item.id).at(-1)
    ?? (linkedId ? store.instructions.find((instruction) => instruction.id === linkedId) : undefined);
  const decisionLabel = decisionOptions.find((choice) => choice.id === option)?.label ?? null;
  const needsOption = section === "decisions" && action === "approve" && decisionOptions.length > 0;
  // A new instruction on a carried item names the earlier one, so the ledger and tomorrow's brief show the chain.
  const itemTitle = linkedId ? `${linkedId} · ${item.title}`.slice(0, 300) : item.title;
  const input: InstructionInput = {
    reportDate: date, section, itemId: item.id, itemTitle, urgent: Boolean(item.urgent), action, note: note.trim(),
    deadline: deadlineActions.includes(action) && deadline ? deadline : null, pic,
    decisionOptionId: needsOption ? option || null : null, decisionLabel: needsOption ? decisionLabel : null,
    linkedId: linkedId ?? null,
  };
  const valid = (action !== "assign" || pic.length > 0) && (!needsOption || Boolean(option));

  async function post(url: string, body?: InstructionInput, key?: string) {
    setBusy(true); setError("");
    try {
      const headers: Record<string, string> = { "X-CSRF-Token": store.csrf, ...(body ? { "Content-Type": "application/json" } : {}), ...(key ? { "Idempotency-Key": key } : {}) };
      const { instruction } = await readJson<{ instruction: Instruction }>(await fetch(url, { method: "POST", headers, ...(body ? { body: JSON.stringify(body) } : {}) }));
      store.save(instruction);
      if (body?.action === "done" && body.linkedId) store.close(body.linkedId);
      setOpen(false); setPreview(false); setNote(""); operation.current = null; setAiRun("idle");
      toast.success("Arahan tercatat", { description: `${item.title} · tersimpan di buku besar arahan.` });
    } catch (cause) { setError((cause as Error).message); } finally { setBusy(false); }
  }
  async function polish() {
    setPolishing(true); setAiRun("writing"); setError("");
    try {
      const result = await readJson<{ note: string }>(await fetch("/api/director/instructions/polish", { method: "POST", headers: { "X-CSRF-Token": store.csrf, "Content-Type": "application/json" }, body: JSON.stringify({ note }) }));
      setNote(result.note); setAiRun("done");
    } catch (cause) { setAiRun("error"); setError((cause as Error).message); } finally { setPolishing(false); }
  }
  function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!preview) { setPreview(true); return; }
    const signature = JSON.stringify(input);
    if (operation.current?.signature !== signature) operation.current = { signature, key: crypto.randomUUID() };
    void post("/api/director/instructions", input, operation.current.key);
  }

  const status = latest && <p className="director-instruction-status" data-state={latest.status} role="status">
    {latest.id} · {actionLabels[latest.action]}{latest.decisionLabel ? ` — ${latest.decisionLabel}` : ""} · {latest.status === "terkendala" ? <InstructionBlockedStatus history={latest.history} /> : statusLabels[latest.status]}
  </p>;
  return <div className="director-instruction">
    {status}
    {error && !open && <p className="director-instruction-error" role="alert">{error}</p>}
    {!open ? <button type="button" className="director-instruction-link" onClick={() => setOpen(true)}>Beri arahan</button>
      : store.state !== "ready" ? <p className="director-instruction-note">{store.state === "loading" ? <LoadingState /> : store.message} <button type="button" className="director-instruction-link" onClick={() => setOpen(false)}>Tutup</button></p>
      : <form className="director-instruction-form" onSubmit={send}>
        {preview ? <pre className="director-instruction-preview">{messageText(input, "IOC-…")}</pre> : <>
          <fieldset><legend>Arahan</legend><div className="director-instruction-actions">
            {instructionActions.map((value) => <label key={value}><input type="radio" name={`action-${section}-${item.id}`} value={value} checked={action === value} onChange={() => setAction(value)} />{actionLabels[value]}</label>)}
          </div></fieldset>
          {needsOption && <fieldset><legend>Pilihan keputusan</legend><div className="director-instruction-actions">
            {decisionOptions.map((choice) => <label key={choice.id}><input type="radio" name={`option-${item.id}`} value={choice.id} checked={option === choice.id} onChange={() => setOption(choice.id)} required />{choice.label}</label>)}
          </div></fieldset>}
          {deadlineActions.includes(action) && <label className="director-instruction-field">Tenggat (opsional)<input type="datetime-local" value={deadline} onChange={(event) => setDeadline(event.target.value)} /></label>}
          <fieldset><legend>{action === "assign" ? "PIC" : "PIC (opsional)"}</legend>{pics.length ? <div className="director-instruction-actions">
            {pics.map((name) => <label key={name}><input type="checkbox" checked={pic.includes(name)} onChange={(event) => setPic(event.target.checked ? [...pic, name] : pic.filter((value) => value !== name))} />{name}</label>)}
          </div> : <p className="director-instruction-note">Daftar pejabat belum tersedia.</p>}</fieldset>
          <div className="director-instruction-note-field">
            <label className="director-instruction-field">Catatan (opsional)<textarea value={note} maxLength={280} rows={2} placeholder="Singkat. Jangan tulis data pasien." disabled={polishing} onChange={(event) => setNote(event.target.value)} /></label>
            <button type="button" className="ai-polish-button" data-busy={polishing || undefined} disabled={busy || polishing || !note.trim()} onClick={() => void polish()}>{polishing ? "Polishing…" : "Polish"}</button>
          </div>
          {aiRun !== "idle" && <AiActivity state={aiRun} label={aiRun === "writing" ? "Merapikan catatan" : undefined} />}
        </>}
        {error && <p className="director-instruction-error" role="alert">{error}</p>}
        <div className="director-instruction-buttons">
          <button className="director-button" type="submit" disabled={busy || polishing || !valid}>{busy ? "Mengirim…" : preview ? "Simpan arahan" : "Lihat pratinjau"}</button>
          <button type="button" className="director-instruction-link" disabled={busy} onClick={() => preview ? setPreview(false) : setOpen(false)}>{preview ? "Ubah" : "Batal"}</button>
        </div>
      </form>}
  </div>;
}
