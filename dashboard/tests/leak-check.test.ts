import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error -- plain ESM tool without type declarations
import { REVIEWED_ASSETS, scan } from "../../tools/leak-check.mjs";

type Finding = { path: string; kind: string };

function tree(files: Record<string, string | Buffer>): string {
  const root = mkdtempSync(join(tmpdir(), "leak-check-"));
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), body);
  }
  return root;
}
const kinds = (root: string) => (scan(root) as Finding[]).map((finding) => `${finding.kind}:${finding.path}`).sort();

describe("leak-check", () => {
  it("flags money, companies, hospital letter numbers and quoted private documents", () => {
    const quoted = Array.from({ length: 21 }, (_, i) => `knowledge/06_CLINICAL_SAFETY/x/doc-${i}.md`).join("\n");
    const root = tree({
      "lib/a.ts": 'const note = "Audit Rp45 juta dan pembayaran Rp12.345.678";',
      "lib/b.ts": 'const vendor = "PT Sumber Contoh Abadi";',
      "lib/c.ts": 'const letter = "123/S.Pern/RSX/V/2031";',
      "lib/d.json": quoted,
    });
    expect(kinds(root)).toEqual(["company:lib/b.ts", "docnumber:lib/c.ts", "private-refs:lib/d.json", "rupiah:lib/a.ts"]);
  });

  it("lets fictional samples and a few document references through", () => {
    const root = tree({
      "lib/a.ts": 'const sample = "001/SPO/CONTOH/I/2099"; const doc = "knowledge/06_CLINICAL_SAFETY/x/doc.md";',
      "lib/b.ts": "const total = 12;",
    });
    expect(kinds(root)).toEqual([]);
  });

  it("flags a picture nobody has looked at, and a reviewed picture that changed", () => {
    const [path, reviewed] = Object.entries(REVIEWED_ASSETS as Record<string, { sha256: string }>)[0];
    const root = tree({ "docs/new-screenshot.png": Buffer.from("not reviewed"), [path]: Buffer.from("changed") });
    expect(kinds(root)).toEqual([`unreviewed-asset:${path}`, "unreviewed-asset:docs/new-screenshot.png"].sort());
    expect(createHash("sha256").update("changed").digest("hex")).not.toBe(reviewed.sha256);
  });
});
