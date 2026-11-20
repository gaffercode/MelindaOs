"use client";

import { useState } from "react";
import type { EpReadiness } from "@/lib/starkes/readiness";
import { toast } from "@/components/ui/toast";

export const STATUS_LABEL = {
  complete: "Lengkap",
  partial: "Sebagian",
  missing: "Belum ada bukti",
  not_applicable: "Tidak diterapkan",
} as const;

export function kitHref(chapter: string, epId: string): string {
  return `/api/starkes/kit?${new URLSearchParams({ chapter, ep: epId })}`;
}

export function EpRow({
  ep,
  canScore,
  onScore,
}: {
  ep: EpReadiness;
  canScore: boolean;
  onScore: (ep: EpReadiness, score: 0 | 5 | 10) => void;
}) {
  const [generating, setGenerating] = useState(false);
  const [generatedDoc, setGeneratedDoc] = useState<{ url: string; title: string; docType: string } | null>(null);

  const approved = new Set(ep.evidence.filter((e) => e.status === "approved").map((e) => e.kind));
  const links = ep.evidence.filter((e) => e.status === "approved" && e.web_link);

  async function handleGenerate() {
    setGenerating(true);
    try {
      const res = await fetch("/api/starkes/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ epId: ep.id, type: "auto" }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Gagal mengompilasi dokumen akreditasi.");
      }
      setGeneratedDoc({
        url: data.data.url,
        title: data.data.title,
        docType: data.data.docType,
      });
      toast.success(`${data.data.docType} Berhasil Dikompilasi`, {
        description: data.data.title,
      });
    } catch (err: unknown) {
      toast.error("Gagal membuat dokumen", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="sv-ep" data-ep={ep.id}>
      <div className="sv-ep-main">
        <p className="sv-ep-text">
          {ep.standardCode} EP {ep.epCode}. {ep.text}
        </p>
        <div className="sv-ep-meta">
          <span className="sv-ep-chips">
            {ep.evidenceKinds.map((kind) => (
              <span
                key={kind}
                className={`sv-chip${
                  approved.has(kind) || ((kind === "W" || kind === "S") && ep.directorScore !== null)
                    ? " is-filled"
                    : ""
                }`}
                data-kind={kind}
                title={approved.has(kind) ? "Ada bukti disetujui" : "Belum ada bukti disetujui"}
              >
                {kind}
              </span>
            ))}
          </span>
          <span className={ep.status === "missing" ? "sv-problem" : undefined}>{STATUS_LABEL[ep.status]}</span>
          {ep.missingKinds.length > 0 && <span className="sv-muted">Kurang: {ep.missingKinds.join(", ")}</span>}
          {links.map((e) => (
            <a key={e.id} className="sv-link" href={e.web_link ?? undefined} target="_blank" rel="noreferrer">
              {e.name ?? "Berkas Drive"}
            </a>
          ))}
          {ep.status !== "not_applicable" && (
            <a className="sv-link" href={kitHref(ep.chapterCode, ep.id)}>
              Unduh kit
            </a>
          )}
          {ep.evidenceKinds.includes("R") && !generatedDoc && (
            <button
              type="button"
              className="sv-generate-btn"
              disabled={generating}
              onClick={handleGenerate}
              title="Kompilasi otomatis draf regulasi resmi (SK Direktur / SPO)"
            >
              {generating ? "Mengompilasi..." : "✨ Buat Regulasi (AI)"}
            </button>
          )}
          {generatedDoc && (
            <a
              className="sv-link sv-link-pdf"
              href={generatedDoc.url}
              target="_blank"
              rel="noreferrer"
              title={generatedDoc.title}
            >
              📄 Buka {generatedDoc.docType} (PDF)
            </a>
          )}
        </div>
      </div>
      {ep.status !== "not_applicable" &&
        (canScore ? (
          <div className="sv-ep-score">
            <label className="sv-ep-label">
              <span className="sv-ep-label-text">Skor Direktur</span>
              <select
                aria-label={`Skor ${ep.standardCode} EP ${ep.epCode}`}
                value={ep.directorScore ?? ""}
                onChange={(event) => {
                  const score = ep.allowedScores.find((s) => String(s) === event.target.value);
                  if (score !== undefined) onScore(ep, score);
                }}
              >
                <option value="" disabled>
                  Saran {ep.score}
                </option>
                {ep.allowedScores.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
          </div>
        ) : (
          <div className="sv-ep-score">
            <span className="sv-ep-score-value">Skor {ep.directorScore ?? ep.score}</span>
          </div>
        ))}
    </div>
  );
}
