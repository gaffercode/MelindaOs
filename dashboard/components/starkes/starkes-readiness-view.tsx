"use client";

import { useMemo, useState } from "react";
import { directorCsrfHeaders } from "@/lib/client-api";
import { computeReadiness, type EpReadiness } from "@/lib/starkes/readiness";
import { LoadingState } from "../loading-state";
import { SectionHeading } from "../melinda-brief/melinda-morning-brief";
import { SourceInfo } from "../source-info";
import { STARKES_TEAM_SOURCE, type StarkesChapterTeams } from "../starkes-team-data";
import { ChapterList } from "./chapter-list";
import { kitHref } from "./ep-row";
import { EvidenceInbox } from "./evidence-inbox";
import { PREDICATE_LABEL, ReadinessHeader } from "./readiness-header";
import { useStarkesData, type StarkesPayload } from "./use-starkes-data";
import "./starkes-readiness.css";

const STATUS_FOR_AUDIT = {
  complete: "verified",
  partial: "draft",
  missing: "missing",
  not_applicable: "not_applicable",
} as const;

export function StarkesReadinessView({
  initial,
  auditRole = null,
  teams = null,
}: {
  initial?: StarkesPayload;
  auditRole?: "director" | null;
  /** Working groups per chapter from the private bucket; null when they could not be loaded. */
  teams?: StarkesChapterTeams | null;
}) {
  const { data, error, reload } = useStarkesData(initial);
  const [notice, setNotice] = useState("");
  const readiness = useMemo(
    () => data && computeReadiness(data.requirements, data.evidence, data.scores, data.rules),
    [data],
  );

  async function score(ep: EpReadiness, value: 0 | 5 | 10) {
    const response = await fetch("/api/starkes/audit", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(await directorCsrfHeaders()) },
      body: JSON.stringify({
        command: "upsert_draft",
        ep_id: ep.id,
        score: value,
        evidence_status: STATUS_FOR_AUDIT[ep.status],
      }),
    }).catch(() => null);
    if (!response?.ok) {
      setNotice("Skor belum tersimpan. Coba lagi.");
      return;
    }
    setNotice("");
    void reload();
  }

  const below = readiness
    ? readiness.chapters.filter((c) => c.percent !== null && c.percent < (c.code === "PROGNAS" ? 100 : readiness.passMark)).length
    : 0;
  const waiting = data ? data.evidence.filter((e) => e.status === "pending").length : 0;

  return (
    <article className="swiss-report-sheet melinda-management-sheet order-sheet starkes-v2">
      <header className="swiss-masthead melinda-brief-masthead">
        <div>
          <h1 className="melinda-brief-title">STARKES</h1>
          <div className="melinda-brief-date">
            Kesiapan survei akreditasi dari bukti yang sudah disetujui Direktur
            <SourceInfo>
              <p className="m-0">
                Daftar elemen penilaian: Instrumen STARKES 47104/2024 (Kemenkes). Bukti dibaca dari folder Google Drive
                Accreditation 2027.
              </p>
              <p className="m-0">{STARKES_TEAM_SOURCE}</p>
            </SourceInfo>
          </div>
        </div>
        {readiness && (
          <dl className="swiss-meta-dl melinda-meta-dl melinda-meta-inline">
            <div className="swiss-meta-item">
              <dt>Prediksi saat ini</dt>
              <dd data-predicate={readiness.predicate}>{PREDICATE_LABEL[readiness.predicate]}</dd>
            </div>
            <div className="swiss-meta-item">
              <dt>Bab di bawah target</dt>
              <dd className={below ? "text-[var(--orange-ink)]" : undefined}>{below}</dd>
            </div>
            <div className="swiss-meta-item">
              <dt>Bukti menunggu</dt>
              <dd>{waiting}</dd>
            </div>
          </dl>
        )}
      </header>

      {error && <p className="sv-problem sv-note" role="status">{error}</p>}
      {notice && <p className="sv-problem sv-note" role="status">{notice}</p>}

      {!readiness ? (
        <p className="sv-muted">
          <LoadingState label="Memuat data STARKES" />
        </p>
      ) : (
        <>
          <ReadinessHeader readiness={readiness} />

          <section className="swiss-section" aria-labelledby="starkes-prioritas">
            <SectionHeading
              id="starkes-prioritas"
              number="02"
              title="Prioritas minggu ini"
              meta="10 elemen penilaian terdekat ke target kelulusan"
            />
            {!readiness.priorities.length ? (
              <p className="sv-muted">Semua bab sudah mencapai target.</p>
            ) : (
              <div className="swiss-table-wrap">
                <table className="swiss-table sv-priority">
                  <thead>
                    <tr>
                      <th scope="col" className="text-left">Elemen penilaian</th>
                      <th scope="col" className="text-left">Kekurangan bukti</th>
                      <th scope="col" className="text-left">Aksi</th>
                    </tr>
                  </thead>
                  <tbody>
                    {readiness.priorities.map((ep) => (
                      <tr key={ep.id}>
                        <td>{ep.standardCode} EP {ep.epCode}. {ep.text}</td>
                        <td>
                          {ep.missingKinds.length > 0 ? (
                            <span className="sv-problem">Kurang: {ep.missingKinds.join(", ")}</span>
                          ) : null}
                        </td>
                        <td>
                          <a className="sv-link" href={kitHref(ep.chapterCode, ep.id)}>
                            Unduh kit
                          </a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <EvidenceInbox
            evidence={data?.evidence ?? []}
            chapterNames={new Map(readiness.chapters.map((c) => [c.code, c.name]))}
            canDecide={auditRole === "director"}
            onChanged={() => void reload()}
          />

          <ChapterList
            chapters={readiness.chapters}
            passMark={readiness.passMark}
            canScore={auditRole === "director"}
            onScore={(ep, value) => void score(ep, value)}
            teams={teams}
          />
        </>
      )}
    </article>
  );
}
