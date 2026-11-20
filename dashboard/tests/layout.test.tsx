import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Children, isValidElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import RootLayout from "@/app/layout";
import { DecisionProvider } from "@/components/decision/decision-provider";

vi.mock("@/app/globals.css", () => ({}));

describe("persistent session layout", () => {
  it("places local decision state above the route-remount boundary", () => {
    const page = <main>Route content</main>;
    const root = RootLayout({ children: page });
    const body = Children.toArray(root.props.children).find((child) => isValidElement(child) && child.type === "body");
    expect(isValidElement(body)).toBe(true);
    if (!isValidElement<{ children: ReactNode }>(body)) throw new Error("Missing body");
    const provider = Children.toArray(body.props.children).find((child) => isValidElement(child) && child.type === DecisionProvider);
    expect(isValidElement(provider)).toBe(true);
    if (!isValidElement<{ children: ReactNode }>(provider)) throw new Error("Missing provider");
    expect(provider.type).toBe(DecisionProvider);
    expect(provider.props.children).toBe(page);
  });

  it("reports real-user page timings with Vercel Speed Insights", () => {
    const source = readFileSync(join(process.cwd(), "app/layout.tsx"), "utf8");
    expect(source).toContain('import { SpeedInsights } from "@vercel/speed-insights/next";');
    expect(source).toMatch(/<body>[\s\S]*<SpeedInsights \/>[\s\S]*<\/body>/);
  });
});
