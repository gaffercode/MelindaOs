import { describe, expect, it } from "vitest";
import { knowledgePath, pathForView, sectionForPath, viewFromSlug } from "@/lib/navigation";

describe("dashboard route map", () => {
  it.each(["knowledge", "integrations"] as const)("maps %s to a reloadable route", (view) => {
    expect(pathForView(view)).toBe(`/${view}`);
    expect(viewFromSlug(view)).toBe(view);
  });
  it("preserves the knowledge overview away from the director homepage", () => {
    expect(pathForView("command")).toBe("/overview");
    expect(viewFromSlug("overview")).toBe("command");
    expect(viewFromSlug("unknown")).toBeNull();
    expect(viewFromSlug("command")).toBeNull();
    expect(viewFromSlug("decisions")).toBeNull();
    expect(viewFromSlug("audit")).toBeNull();
  });
  it("encodes search input as query text rather than a destination", () => {
    expect(knowledgePath("  BPJS & klaim  ")).toBe("/knowledge?q=BPJS+%26+klaim");
    expect(knowledgePath("")).toBe("/knowledge");
    expect(knowledgePath("javascript:alert(1)")).toMatch(/^\/knowledge\?q=/);
  });
});

describe("loading skeleton frame", () => {
  it.each([
    ["/", { frame: "director", section: "melinda" }],
    ["/arahan", { frame: "director", section: "arahan" }],
    ["/arahan/arsip", { frame: "director", section: "arahan" }],
    ["/satu-sehat", { frame: "director", section: "satu-sehat" }],
    ["/berita", { frame: "director", section: "berita" }],
    ["/studio", { frame: "director", section: "studio" }],
    ["/starkes", { frame: "director", section: "starkes" }],
    ["/casemix", { frame: "director", section: "casemix" }],
    ["/order-obat", { frame: "director", section: "order-obat" }],
    ["/formularium", { frame: "director", section: "formularium" }],
    ["/overview", { frame: "workspace", view: "command" }],
    ["/knowledge", { frame: "workspace", view: "knowledge" }],
    ["/agents", { frame: "plain" }],
    ["/kredensial", { frame: "plain" }],
    ["/director-review", { frame: "plain" }],
    ["/director-login", { frame: "plain" }],
    ["/laporan-unit", { frame: "plain" }],
    ["/melinda", { frame: "director", section: "melinda-agent" }],
    ["/tidak-ada", { frame: "plain" }],
    ["/starkes/", { frame: "director", section: "starkes" }],
  ])("sectionForPath(%s)", (path, expected) => expect(sectionForPath(path)).toEqual(expected));
});
