import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/", useRouter: () => ({ push: vi.fn() }) }));

const { ShellSkeletonFrame } = await import("@/components/shell-skeleton");

describe("ShellSkeletonFrame", () => {
  it("shows a loading status and no role-specific navigation entries", () => {
    const html = renderToStaticMarkup(<ShellSkeletonFrame frame={{ frame: "director", section: "starkes" }} />);
    expect(html).not.toContain('href="/starkes"');
    expect(html).not.toContain('href="/studio"');
    expect(html).not.toContain('aria-current="page"');
    expect(html).toContain('role="status"');
    expect(html).toContain("Memuat");
  });

  it("shows only the status on the plain frame", () => {
    const html = renderToStaticMarkup(<ShellSkeletonFrame frame={{ frame: "plain" }} />);
    expect(html).toContain('role="status"');
    expect(html).toContain("Memuat");
    expect(html).not.toContain("sidebar-link");
  });

  it.each([{ frame: "director", section: "melinda" }, { frame: "workspace", view: "knowledge" }, { frame: "plain" }] as const)("never uses uppercase in %o", (frame) => {
    expect(renderToStaticMarkup(<ShellSkeletonFrame frame={frame} />)).not.toContain("uppercase");
  });
});
