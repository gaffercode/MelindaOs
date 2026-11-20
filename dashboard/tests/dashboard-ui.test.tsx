import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup as renderMarkup } from "react-dom/server";
import { DecisionProvider } from "@/components/decision/decision-provider";
import { describe, expect, it, vi } from "vitest";
import { DashboardApp, DecisionTable, KnowledgeView } from "@/components/dashboard-app";
import { HookSidebar } from "@/components/ui/hook-sidebar";
import { Sidebar } from "@/components/shell";
import type { DashboardData } from "@/lib/contracts";
import type { Decision } from "@/lib/decision/decision-state";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

function renderToStaticMarkup(node: ReactNode): string {
  return renderMarkup(<DecisionProvider>{node}</DecisionProvider>);
}

const decision: Decision = { id: "d", title: "Test decision", priority: "high", owner: "OPS", dueDate: "2026-10-05", recommendation: "Validate scope", status: "local_draft", resolutionReason: "", createdAt: "2026-10-03T00:00:00Z", updatedAt: "2026-10-03T00:00:00Z" };
const data: DashboardData = { validation: { status: "unavailable", scannedAt: "2026-10-03T00:00:00Z", passed: 0, total: 0, counts: [], limitation: "Not semantic validation" }, providers: [], documentCount: 0 };

function elements(node: ReactNode): Array<ReactElement<Record<string, unknown>>> {
  const found: Array<ReactElement<Record<string, unknown>>> = [];
  Children.forEach(node, (child) => {
    if (!isValidElement<Record<string, unknown>>(child)) return;
    found.push(child, ...elements(child.props.children as ReactNode));
  });
  return found;
}

function click(node: ReactNode, label: string) {
  const button = elements(node).find((item) => item.type === "button" && (item.props["aria-label"] === label || item.props.children === label));
  expect(button, label).toBeDefined();
  const handler = button?.props.onClick;
  expect(typeof handler).toBe("function");
  (handler as () => void)();
}

describe("dashboard page rendering", () => {
  it.each([
    ["command", "Welcome back, Dr. Ferdi"], ["knowledge", "Pengetahuan"], ["integrations", "Integrasi"],
  ] as const)("renders %s without runtime errors", (activeView, heading) => {
    const html = renderToStaticMarkup(<DashboardApp activeView={activeView} />);
    expect(html).toMatch(new RegExp(`<h1[^>]*>${heading}</h1>`));
    expect(html).toContain('aria-current="page"');
  });
});

describe("repository snapshot loading", () => {
  it.each(["knowledge", "integrations"] as const)("shows the snapshot loader on %s", (activeView) => {
    expect(renderToStaticMarkup(<DashboardApp activeView={activeView} />)).toContain("Memuat snapshot repository");
  });
});

describe("real component handler bindings", () => {
  it("uses the official logo asset rather than a letter placeholder", () => {
    const html = renderToStaticMarkup(Sidebar({ activeView: "command", onNavigate: vi.fn() }));
    expect(html).toContain('alt="MelindaOS"');
    expect(html).toContain('/brand/melindaos-logo.png');
  });
  it("wires all sidebar destinations", () => {
    const navigate = vi.fn();
    const tree = Sidebar({ activeView: "command", onNavigate: navigate });
    // The Sistem rail is the one HookSidebar with an onChange; choosing each row must navigate to its view.
    const system = elements(tree).find((item) => item.type === HookSidebar && typeof item.props.onChange === "function");
    expect(system).toBeDefined();
    const rail = system!.props as { items: unknown[]; onChange: (index: number) => void };
    for (let index = 0; index < rail.items.length; index++) rail.onChange(index);
    expect(navigate.mock.calls.map(([view]) => view)).toEqual(["command", "knowledge", "integrations"]);
  });
  it("wires edit, resolve and reopen to the correct decision", () => {
    const onEdit = vi.fn(), onResolve = vi.fn(), onReopen = vi.fn();
    const props = { onEdit, onResolve, onReopen };
    const tree = DecisionTable({ ...props, decisions: [decision] });
    click(tree, "Edit Test decision");
    click(tree, "Resolve Test decision");
    click(DecisionTable({ ...props, decisions: [{ ...decision, status: "locally_resolved" }] }), "Reopen Test decision");
    expect(onEdit).toHaveBeenCalledWith(decision);
    expect(onResolve).toHaveBeenCalledWith(decision);
    expect(onReopen.mock.calls[0][0].status).toBe("locally_resolved");
  });
  it("binds search submission, text changes and failure feedback", () => {
    const onSearch = vi.fn().mockResolvedValue(undefined), setQuery = vi.fn();
    const tree = KnowledgeView({ data, query: "", setQuery, onSearch, results: [], searching: false, error: "Search unavailable" });
    const form = elements(tree).find((item) => item.type === "form");
    expect(form?.props.onSubmit).toBe(onSearch);
    const input = elements(tree).find((item) => item.props.id === "knowledge-search");
    (input?.props.onChange as (event: { target: { value: string } }) => void)({ target: { value: "BPJS" } });
    expect(setQuery).toHaveBeenCalledWith("BPJS");
    expect(renderToStaticMarkup(tree)).toContain('role="alert"');
  });
  const result = (path: string, match: "full" | "partial") => ({ path, category: "A" as const, title: path, docId: "KB", domain: "Klinis", department: "Umum", lastReviewed: "2026-09-28", tags: [], snippet: "cuplikan", match });
  const knowledge = (results: ReturnType<typeof result>[]) => renderToStaticMarkup(KnowledgeView({ data, query: "x", setQuery: vi.fn(), onSearch: vi.fn().mockResolvedValue(undefined), results, searching: false, error: "" }));
  it("marks where nearest results begin when they follow full matches", () => {
    const html = knowledge([result("a.md", "full"), result("b.md", "partial"), result("c.md", "partial")]);
    expect(html.match(/Hasil terdekat/g)).toHaveLength(1);
    expect(html.indexOf("a.md")).toBeLessThan(html.indexOf("Hasil terdekat"));
    expect(html.indexOf("Hasil terdekat")).toBeLessThan(html.indexOf("b.md"));
    expect(html).not.toContain("Tidak ada dokumen yang memuat semua kata");
  });
  it("says so when every result is a nearest result, and stays quiet when all are full matches", () => {
    expect(knowledge([result("b.md", "partial")])).toContain("Tidak ada dokumen yang memuat semua kata. Menampilkan hasil terdekat.");
    const full = knowledge([result("a.md", "full")]);
    expect(full).not.toContain("terdekat");
  });
});

describe("Director navigation prefetch", () => {
  it.each(["components/shell.tsx", "components/director/director-shell.tsx"])("%s keeps the default prefetch down to the loading boundary", async (file) => {
    const { readFileSync } = await import("node:fs");
    expect(readFileSync(file, "utf8")).not.toContain("prefetch={false}");
  });
});
