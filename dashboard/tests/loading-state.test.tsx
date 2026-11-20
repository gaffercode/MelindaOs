import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LoadingState } from "@/components/loading-state";

describe("LoadingState", () => {
  it("renders a status with the label, the elapsed counter, and a 3×3 animated grid", () => {
    const html = renderToStaticMarkup(<LoadingState label="Mencari jawaban" />);
    expect(html).toContain('role="status"');
    expect(html).toContain("Mencari jawaban");
    expect(html).toContain("0.0s");
    expect(html.match(/pixel-on 650ms/g)).toHaveLength(9);
    expect(html).toContain("shimmer-text");
  });

  it("defaults the label to Memuat and never uses uppercase classes", () => {
    const html = renderToStaticMarkup(<LoadingState />);
    expect(html).toContain("Memuat");
    expect(html).not.toContain("uppercase");
  });

  it("leaves the orbit corner gaps dim and unanimated", () => {
    const html = renderToStaticMarkup(<LoadingState variant="orbit" />);
    expect(html.match(/pixel-on 950ms/g)).toHaveLength(8);
    expect(html).toContain("animation:none");
  });
});
