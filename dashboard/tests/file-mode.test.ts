import { afterEach, describe, expect, it, vi } from "vitest";
import { fileModeWarning } from "@/lib/director/director-auth";

describe("fileModeWarning", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("returns null in protected mode", () => {
    vi.stubEnv("MELINDAOS_DIRECTOR_STORE", "supabase");
    expect(fileModeWarning()).toBeNull();
  });

  it("names the way out when running in file mode", () => {
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("MELINDAOS_DIRECTOR_STORE", "file");
    const warning = fileModeWarning();
    expect(warning).not.toBeNull();
    expect(warning).toContain("tanpa login");
    expect(warning).toContain("MELINDAOS_DIRECTOR_STORE=supabase");
  });
});
