import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

const evaluated = vi.fn();
const { MockDrawer } = vi.hoisted(() => ({ MockDrawer: () => null }));
vi.mock("@/components/instruction/quick-instruction-panel", () => {
  evaluated();
  return { QuickInstructionDrawer: MockDrawer };
});

describe("Arahan panel preload", () => {
  it("does not load the panel chunk until asked, then loads it once and renders it without suspending", async () => {
    const { arahanDrawer, preloadArahanPanel } = await import("@/components/instruction/quick-instruction-button");
    expect(evaluated).not.toHaveBeenCalled();
    expect(arahanDrawer()).not.toBe(MockDrawer);
    await preloadArahanPanel();
    await preloadArahanPanel();
    expect(evaluated).toHaveBeenCalledTimes(1);
    // A preloaded panel renders directly: React.lazy would still suspend for one render and flash the loading drawer.
    expect(arahanDrawer()).toBe(MockDrawer);
  });

  it("starts the download when the pointer reaches the Arahan button or it gets focus", () => {
    const source = readFileSync("components/instruction/quick-instruction-button.tsx", "utf8");
    expect(source).toContain("onPointerEnter={preloadArahanPanel}");
    expect(source).toContain("onFocus={preloadArahanPanel}");
  });
});
