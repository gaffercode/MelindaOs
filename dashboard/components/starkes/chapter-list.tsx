"use client";

import { useState } from "react";
import { fromStarkesChapter, openArahan } from "@/lib/instruction/instruction-prefill";
import type { ChapterReadiness, EpReadiness } from "@/lib/starkes/readiness";
import { SectionHeading } from "../melinda-brief/melinda-morning-brief";
import { chapterLeadLabel, type StarkesChapterTeams } from "../starkes-team-data";
import { EpRow } from "./ep-row";

export function ChapterList({
  chapters,
  passMark,
  canScore,
  onScore,
  teams,
}: {
  chapters: ChapterReadiness[];
  passMark: number;
  canScore: boolean;
  onScore: (ep: EpReadiness, score: 0 | 5 | 10) => void;
  teams: StarkesChapterTeams | null;
}) {
  const [notice, setNotice] = useState("");
  return (
    <section className="swiss-section" aria-labelledby="starkes-bab">
      <SectionHeading id="starkes-bab" number="04" title="Elemen penilaian per bab" meta="16 bab instrumen STARKES 47104/2024" />
      {notice && <p className="sv-problem" role="status">{notice}</p>}
      <div className="sv-chapter-deck">
        {chapters.map((c) => {
          const id = c.code.toLowerCase();
          const lead = teams?.[id]?.lead ?? null;
          const target = c.code === "PROGNAS" ? 100 : passMark;
          return (
            <details key={c.code} className="sv-chapter">
              <summary>
                <div className="sv-summary-grid">
                  <span className="sv-sum-code">
                    <b>{c.code}</b>
                  </span>
                  <span className="sv-sum-name">{c.name}</span>
                  <span
                    className={`sv-sum-pct ${
                      c.percent !== null && c.percent < target ? "sv-problem" : "sv-muted"
                    }`}
                  >
                    {c.percent === null ? "Tidak diterapkan" : `${c.percent}%`}
                  </span>
                  <span className="sv-sum-eps sv-muted">{c.eps.length} EP</span>
                  <span className="sv-lead">
                    <span className="sv-lead-title">Ketua pokja:</span>{" "}
                    <span className={lead === null && teams?.[id] ? "sv-problem" : undefined}>
                      {chapterLeadLabel(teams, id)}
                    </span>
                  </span>
                  <span className="sv-sum-act">
                    <button
                      type="button"
                      className="sv-link"
                      aria-label={`Arahan untuk bab ${c.code}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (!openArahan({ context: "STARKES Command", draft: fromStarkesChapter(c, lead) })) {
                          setNotice("Panel arahan hanya tersedia setelah masuk sebagai Direktur.");
                        }
                      }}
                    >
                      Arahan
                    </button>
                  </span>
                </div>
              </summary>
              <div className="sv-chapter-body">
                {c.eps.map((ep) => (
                  <EpRow key={ep.id} ep={ep} canScore={canScore && c.applicable} onScore={onScore} />
                ))}
              </div>
            </details>
          );
        })}
      </div>
    </section>
  );
}
