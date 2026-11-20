"use client";

import { useState } from "react";
import { directorCsrfHeaders } from "@/lib/client-api";
import type { StarkesEvidence } from "@/lib/starkes/evidence-store";
import { SectionHeading } from "../melinda-brief/melinda-morning-brief";

type SyncResult = { scanned: number; newPending: number; withdrawn: number; errors: string[] };

export function EvidenceInbox({
  evidence,
  chapterNames,
  canDecide,
  onChanged,
}: {
  evidence: StarkesEvidence[];
  chapterNames: Map<string, string>;
  canDecide: boolean;
  onChanged: () => void;
}) {
  const pending = evidence.filter((e) => e.status === "pending");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function post(url: string, body: unknown): Promise<Response> {
    return fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(await directorCsrfHeaders()) },
      body: JSON.stringify(body),
    });
  }

  async function decide(status: "approved" | "rejected") {
    setBusy(true);
    const response = await post("/api/starkes/evidence", { ids: [...selected], status }).catch(() => null);
    setBusy(false);
    if (!response?.ok) {
      setMessage("Keputusan belum tersimpan. Coba lagi.");
      return;
    }
    setSelected(new Set());
    setMessage(status === "approved" ? "Bukti disetujui." : "Bukti ditolak.");
    onChanged();
  }

  async function sync() {
    setBusy(true);
    setMessage("Menyinkronkan Google Drive…");
    const response = await post("/api/starkes/drive-sync", {}).catch(() => null);
    setBusy(false);
    const result = response?.ok ? ((await response.json()) as SyncResult) : null;
    if (!result) {
      setMessage("Sinkronisasi gagal. Coba lagi nanti.");
      return;
    }
    setMessage(
      result.errors.length
        ? result.errors.join(" ")
        : `${result.scanned} berkas dibaca, ${result.newPending} bukti baru, ${result.withdrawn} ditarik.`,
    );
    onChanged();
  }

  const chapters = [...new Set(pending.map((e) => e.chapter_code))];
  return (
    <section className="swiss-section sv-inbox" aria-labelledby="starkes-bukti">
      <SectionHeading id="starkes-bukti" number="03" title="Bukti masuk" meta="Folder Google Drive Accreditation 2027" />

      {canDecide && (
        <div className="sv-toolbar">
          <div className="sv-actions">
            <button type="button" className="button-secondary" disabled={busy} onClick={() => void sync()}>
              Sinkronkan Drive
            </button>
            <button type="button" className="button-primary" disabled={busy || !selected.size} onClick={() => void decide("approved")}>
              Setujui terpilih
            </button>
            <button type="button" className="button-secondary" disabled={busy || !selected.size} onClick={() => void decide("rejected")}>
              Tolak terpilih
            </button>
          </div>
        </div>
      )}

      {message && (
        <p
          role="status"
          className={
            message.startsWith("Akses") || message.includes("gagal") || message.includes("belum")
              ? "sv-problem"
              : "sv-muted"
          }
        >
          {message}
        </p>
      )}

      {!pending.length && (
        <p className="sv-empty-state sv-muted">Belum ada bukti baru dari Google Drive.</p>
      )}

      {chapters.map((code) => (
        <div key={code} className="sv-table-card">
          <h3 className="sv-table-caption">
            <span className="sv-table-caption-code">{code}</span>
            <span>{chapterNames.get(code) ?? ""}</span>
          </h3>
          <div className="swiss-table-wrap">
            <table className="swiss-table">
              <thead>
                <tr>
                  <th scope="col" className="sv-col-check">
                    Pilih
                  </th>
                  <th scope="col">Berkas</th>
                  <th scope="col">EP yang dicocokkan</th>
                  <th scope="col" className="sv-col-kind">
                    Jenis
                  </th>
                </tr>
              </thead>
              <tbody>
                {pending
                  .filter((e) => e.chapter_code === code)
                  .map((e) => (
                    <tr key={e.id}>
                      <td className="sv-col-check">
                        <input
                          type="checkbox"
                          aria-label={`Pilih ${e.phi_flag ? "berkas" : e.name ?? "berkas"}`}
                          disabled={!canDecide}
                          checked={selected.has(e.id)}
                          onChange={(event) =>
                            setSelected((prev) => {
                              const next = new Set(prev);
                              if (event.target.checked) next.add(e.id);
                              else next.delete(e.id);
                              return next;
                            })
                          }
                        />
                      </td>
                      <td>
                        {e.web_link ? (
                          <a className="sv-link" href={e.web_link} target="_blank" rel="noreferrer">
                            {e.name}
                          </a>
                        ) : (
                          e.name
                        )}
                        {e.phi_flag && <span className="sv-problem"> Nama berkas saja</span>}
                      </td>
                      <td>
                        {e.ep_ids.length ? (
                          e.ep_ids.map((id) => id.replace(/^47104-2024:/, "")).join(", ")
                        ) : (
                          <span className="sv-problem">Belum cocok dengan EP</span>
                        )}
                      </td>
                      <td className="sv-col-kind">{e.kind ?? "-"}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </section>
  );
}
