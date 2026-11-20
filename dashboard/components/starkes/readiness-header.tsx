import type { Readiness } from "@/lib/starkes/readiness";
import type { Predicate } from "@/lib/starkes/scoring";
import { staggerStyle } from "@/lib/stagger-style";
import { SectionHeading } from "../melinda-brief/melinda-morning-brief";

export const PREDICATE_LABEL: Record<Predicate, string> = {
  paripurna: "Paripurna",
  utama: "Utama",
  madya: "Madya",
  tidak_terakreditasi: "Tidak terakreditasi",
};

/** Section 01: how far each chapter is from the pass mark, and what blocks the predicate. */
export function ReadinessHeader({ readiness }: { readiness: Readiness }) {
  const names = new Map(readiness.chapters.map((c) => [c.code, c.name]));
  return (
    <section className="swiss-section" aria-labelledby="starkes-capaian">
      <SectionHeading
        id="starkes-capaian"
        number="01"
        title="Capaian per bab"
        meta={`Prediksi saat ini: ${PREDICATE_LABEL[readiness.predicate]}`}
      />
      <p className="sv-note">
        Target minimal: Utama · Target tinggi: Paripurna
      </p>
      {readiness.blocking.length > 0 && (
        <p className="sv-note sv-problem">
          Penghambat: {readiness.blocking.map((code) => `${code} ${names.get(code) ?? ""}`.trim()).join(", ")}
        </p>
      )}
      <div className="swiss-table-wrap">
        <table className="swiss-table sv-matrix">
          <thead>
            <tr>
              <th scope="col" className="text-left">Bab akreditasi</th>
              <th scope="col" className="text-left">Progres capaian dan target survei</th>
              <th scope="col" className="sv-num">Nilai</th>
            </tr>
          </thead>
          <tbody>
            {readiness.chapters.map((c, index) => {
              const target = c.code === "PROGNAS" ? 100 : readiness.passMark;
              const low = c.percent !== null && c.percent < target;
              return (
                <tr key={c.code}>
                  <th scope="row" className="sv-bar-name">
                    {c.code} · {c.name}
                  </th>
                  <td className="sv-bar-track-cell">
                    <span
                      className="sv-track"
                      role="img"
                      aria-label={
                        c.percent === null
                          ? `${c.code} tidak diterapkan`
                          : `${c.code} ${c.percent}% dari target ${target}%`
                      }
                    >
                      {c.percent !== null && (
                        <span
                          className={`sv-fill${low ? " is-low" : ""}`}
                          style={staggerStyle({ display: "block", width: `${c.percent}%` }, index)}
                        />
                      )}
                      <span className="sv-mark" style={{ right: 0 }} />
                    </span>
                  </td>
                  <td className={`sv-num sv-pct${low ? " sv-problem" : ""}`}>
                    {c.percent === null ? "Tidak diterapkan" : `${c.percent}%`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
