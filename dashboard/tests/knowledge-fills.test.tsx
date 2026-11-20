// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { FillLists } from "@/components/fill-lists";
import type { AiFill } from "@/lib/contracts";

const FACT: AiFill = { placeholder: "[ISI nama RS]", value: "RSIA Melinda DHAI", method: "fact", sourceRef: "dashboard/data/studio/facts.json" };
const TYPED: AiFill = { placeholder: "[ISI jam]", value: "07.00", method: "director", sourceRef: "director-answer:00000000000000aa" };
const CONFIRMED: AiFill = { placeholder: "[CEK]", value: "", method: "director", sourceRef: "director-answer:00000000000000bb" };

afterEach(() => { cleanup(); });

describe("fills of a knowledge document", () => {
  it("lists the Director's answers apart from automatic fills", () => {
    render(<FillLists fills={[FACT, TYPED, CONFIRMED]} />);
    expect(screen.getByText("Diisi otomatis (1)")).toBeTruthy();
    expect(screen.getByText("[ISI nama RS] → RSIA Melinda DHAI · sumber dashboard/data/studio/facts.json (fact)")).toBeTruthy();
    expect(screen.getByText("Dijawab Direktur (2)")).toBeTruthy();
    expect(screen.getByText("[ISI jam] → 07.00")).toBeTruthy();
    expect(screen.getByText("[CEK] → (dikonfirmasi)")).toBeTruthy();
    expect(document.body.textContent).not.toContain("director-answer:");
  });

  it("shows no Director group when every fill is automatic", () => {
    render(<FillLists fills={[FACT, { ...FACT, placeholder: "[CEK]", value: "", method: "session" }]} />);
    expect(screen.getByText("Diisi otomatis (2)")).toBeTruthy();
    expect(screen.getByText("[CEK] → (dikonfirmasi) · sumber dashboard/data/studio/facts.json (session)")).toBeTruthy();
    expect(screen.queryByText(/Dijawab Direktur/)).toBeNull();
  });

  it("shows no automatic group when every fill is the Director's", () => {
    render(<FillLists fills={[TYPED]} />);
    expect(screen.getByText("Dijawab Direktur (1)")).toBeTruthy();
    expect(screen.queryByText(/Diisi otomatis/)).toBeNull();
  });

  it("renders nothing without fills", () => {
    const { container } = render(<FillLists fills={[]} />);
    expect(container.innerHTML).toBe("");
  });
});
