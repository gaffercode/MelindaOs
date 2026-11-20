import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MelindaMarkdown } from "@/components/melinda/melinda-markdown";

const render = (text: string) => renderToStaticMarkup(<MelindaMarkdown text={text} />);

describe("MelindaMarkdown", () => {
  it("renders paragraphs, bold and code", () => {
    expect(render("Halo **Pak** Direktur\nbaris dua\n\nParagraf `dua`")).toBe("<p>Halo <strong>Pak</strong> Direktur\nbaris dua</p><p>Paragraf <code>dua</code></p>");
  });

  it("renders bullet and numbered lists, and a short heading", () => {
    expect(render("### Ringkasan\n- satu\n- dua\n\n1. pertama\n2) kedua")).toBe("<h3>Ringkasan</h3><ul><li>satu</li><li>dua</li></ul><ol><li>pertama</li><li>kedua</li></ol>");
  });

  it("switches list kind without merging them", () => {
    expect(render("- a\n1. b")).toBe("<ul><li>a</li></ul><ol><li>b</li></ol>");
  });

  it("never turns text into HTML", () => {
    const html = render("<img src=x onerror=alert(1)> **<b>tebal</b>**");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
    expect(html).toContain("<strong>&lt;b&gt;tebal&lt;/b&gt;</strong>");
  });

  it("leaves an unfinished marker as plain text while streaming", () => {
    expect(render("Sedang **menulis")).toBe("<p>Sedang **menulis</p>");
  });
});
