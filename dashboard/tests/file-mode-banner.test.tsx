import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocalModeBanner } from "@/components/local-mode-banner";

describe("local mode banner", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("shows the no-login warning in file mode", () => {
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("MELINDAOS_DIRECTOR_STORE", "file");
    const html = renderToStaticMarkup(<LocalModeBanner />);
    expect(html).toContain("Mode lokal — tanpa login");
    expect(html).toContain("MELINDAOS_DIRECTOR_STORE=supabase");
  });

  it("renders nothing in protected mode", () => {
    vi.stubEnv("MELINDAOS_DIRECTOR_STORE", "supabase");
    expect(renderToStaticMarkup(<LocalModeBanner />)).toBe("");
  });
});
