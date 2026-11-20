"use client";

import { type FormEvent, useState } from "react";
import Link from "next/link";
import { MessageCircleQuestion } from "lucide-react";
import type { AskResult } from "@/lib/ask/answer";
import { fetchAsk } from "@/lib/client-api";
import { knowledgePath } from "@/lib/navigation";
import { AiActivity } from "./ai-activity";

/** `linkSources={false}` lists sources as plain text, for people who may not open the knowledge page. */
export function AskAnswer({ result, linkSources = true }: { result: AskResult; linkSources?: boolean }) {
  return <div className="mt-4 grid gap-3">
    <p className={`m-0 whitespace-pre-line text-[length:var(--type-body)] leading-relaxed ${result.status === "escalate" ? "text-[var(--warn)]" : ""}`}>{result.answer}</p>
    {result.sources.length > 0 && <div>
      <p className="m-0 text-sm font-medium text-[var(--muted)]">Sumber</p>
      <ul className="m-0 mt-1 grid list-none gap-1 p-0">
        {result.sources.map((source) => <li key={`${source.docId}-${source.heading}`}>
          {linkSources
            ? <Link href={knowledgePath(source.docId || source.title.slice(0, 120))} className="text-[length:var(--type-body)] text-[var(--accent)] underline-offset-2 hover:underline">{source.title} › {source.heading}</Link>
            : <span className="text-[length:var(--type-body)]">{source.title} › {source.heading}</span>}
        </li>)}
      </ul>
    </div>}
  </div>;
}

/** Ask box on the knowledge view: one grounded answer from MelindaOS documents, with sources. */
export function AskMelinda({ linkSources = true }: { linkSources?: boolean }) {
  const [question, setQuestion] = useState("");
  const [result, setResult] = useState<AskResult | null>(null);
  const [error, setError] = useState("");
  const [asking, setAsking] = useState(false);
  const [run, setRun] = useState<"idle" | "asking" | "done" | "error">("idle");

  async function submit(event: FormEvent) {
    event.preventDefault();
    const text = question.trim();
    if (!text || asking) return;
    setAsking(true); setRun("asking"); setError(""); setResult(null);
    try { setResult(await fetchAsk(text)); setRun("done"); } catch (caught: unknown) { setRun("error"); setError(caught instanceof Error ? caught.message : "Tanya Melinda sedang tidak tersedia."); } finally { setAsking(false); }
  }

  return <section aria-labelledby="ask-melinda-title" className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4">
    <h2 id="ask-melinda-title" className="m-0 flex items-center gap-2 text-[length:var(--type-title-sm)] font-medium"><MessageCircleQuestion className="size-5 text-[var(--accent)]" aria-hidden="true" />Tanya Melinda</h2>
    <form onSubmit={submit} className="mt-3 flex flex-col gap-2 sm:flex-row">
      <label htmlFor="ask-melinda" className="sr-only">Pertanyaan untuk Tanya Melinda</label>
      <input id="ask-melinda" value={question} onChange={(event) => setQuestion(event.target.value)} maxLength={500} placeholder="Contoh: Bagaimana SPO identifikasi pasien di ruang bayi?" className="h-12 w-full min-w-0 rounded-lg sm:flex-1 border border-[var(--line)] px-3 text-[length:var(--type-body)] outline-none focus:border-[var(--accent)]" />
      <button type="submit" disabled={asking || !question.trim()} className="h-12 rounded-lg bg-[var(--accent)] px-5 text-[length:var(--type-body)] font-medium text-white disabled:opacity-60">Tanya</button>
    </form>
    {run !== "idle" && <div className="mt-3"><AiActivity state={run === "asking" ? "researching" : run} label={run === "asking" ? "Mencari jawaban" : undefined} /></div>}
    {error && <p role="alert" className="m-0 mt-3 text-[length:var(--type-body)] text-[var(--warn)]">{error}</p>}
    {result && <AskAnswer result={result} linkSources={linkSources} />}
  </section>;
}
