import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/health/route";

describe("GET /api/health", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("reports local mode without exposing configuration values", async () => {
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("MELINDAOS_DIRECTOR_STORE", "file");
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const body = await response.json();
    expect(body).toMatchObject({ status: "ok", mode: "local", director: "not_configured", medifyPublisher: "not_configured" });
    expect(["present", "absent"]).toContain(body.knowledgeIndex);
  });

  it("reports protected mode with broken configuration as not configured", async () => {
    vi.stubEnv("MELINDAOS_DIRECTOR_STORE", "supabase");
    vi.stubEnv("MELINDAOS_SUPABASE_SECRET_KEY", "sb_secret_should_never_leak"); // secret-scan:allow (fake key)
    vi.stubEnv("MELINDAOS_APP_ORIGIN", "not a url");
    const response = await GET();
    const text = await response.text();
    expect(JSON.parse(text)).toMatchObject({ status: "ok", mode: "protected", director: "not_configured", medifyPublisher: "not_configured" });
    expect(text).not.toContain("sb_secret");
  });

  it("reports the Medify receiver as configured when the token hash is present, without leaking it", async () => {
    vi.stubEnv("MELINDAOS_DIRECTOR_STORE", "supabase");
    vi.stubEnv("MELINDAOS_MEDIFY_PUBLISHER_TOKEN_HASH", "a".repeat(64));
    const response = await GET();
    const text = await response.text();
    expect(JSON.parse(text).medifyPublisher).toBe("configured");
    expect(text).not.toContain("a".repeat(64));
  });
});
