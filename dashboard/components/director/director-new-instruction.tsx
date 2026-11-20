"use client";

import { useState } from "react";
import { DirectorInstruction } from "./director-instruction";

/**
 * A free-form instruction (section `umum`), not tied to a brief item: the Director types what it is about,
 * then uses the same action/PIC/deadline form as every other item. One item id per mount, so a second
 * instruction on the same page needs a reload. Requires migration 202610280001 on the store.
 */
export function DirectorNewInstruction({ date }: { date: string }) {
  const [title, setTitle] = useState("");
  const [itemId] = useState(() => `UMUM-${date.replaceAll("-", "")}-${Math.random().toString(36).slice(2, 8)}`);
  const trimmed = title.trim();
  return (
    <section className="director-new-instruction" aria-labelledby="arahan-baru">
      <h2 id="arahan-baru" className="swiss-section-heading">Arahan baru</h2>
      <label className="director-instruction-field">Perihal<input value={title} maxLength={300} placeholder="Satu kalimat. Jangan tulis data pasien." onChange={(event) => setTitle(event.target.value)} /></label>
      {trimmed ? <DirectorInstruction date={date} section="umum" item={{ id: itemId, title: trimmed }} /> : <p className="director-instruction-note">Tulis perihalnya dulu, lalu pilih arahan.</p>}
    </section>
  );
}
