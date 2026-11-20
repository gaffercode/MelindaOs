import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ScheduleTable } from "@/components/melinda-brief/schedule-table";

describe("agenda rows", () => {
  it("offers Teruskan ke staf on every row", () => {
    const items = [
      { waktu: "10.00–10.15", kegiatan: "Lead Brief seluruh struktural", siapa: "Seluruh struktural", topikTindakLanjut: "Materi utama." },
      { waktu: "10.15–10.30", kegiatan: "Kickoff kredensial", siapa: "Direktur / dr. Novia / Bu Oriza", topikTindakLanjut: "Kunci PIC." },
    ];
    const html = renderToStaticMarkup(<ScheduleTable date="2026-11-05" items={items} />);
    expect(html.match(/>Teruskan ke staf</g)).toHaveLength(2);
    expect(html).toContain('aria-label="Teruskan ke staf: Kickoff kredensial"');
  });
});
