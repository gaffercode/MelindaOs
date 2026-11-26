import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hashSecret } from "@/lib/director/director-auth";
import { DirectorApiError } from "@/lib/director/director-api";
import { authenticateMcp } from "@/lib/mcp/auth";

const KATT = "katt-token-for-test-only-0001";
const OPENBOT = "openbot-token-for-test-only-0002";
const SHARED = "shared-token-for-test-only-0003";

function request(token?: string): Request {
  const headers: Record<string, string> = {};
  if (token !== undefined) headers.Authorization = `Bearer ${token}`;
  return new Request("https://melindaos.app/api/mcp", { method: "POST", headers });
}

async function rejection(promise: Promise<unknown>): Promise<DirectorApiError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof DirectorApiError) return error;
    throw error;
  }
  throw new Error("expected authenticateMcp to reject");
}

describe("authenticateMcp per-bot tokens", () => {
  beforeEach(() => {
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("MELINDAOS_MCP_TOKEN", "");
    vi.stubEnv("MELINDAOS_MCP_TOKEN_HASH", "");
    vi.stubEnv("MELINDAOS_MCP_TOKEN_HASHES", "");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("accepts each bot's own token and names the credential, keeping the shared agent identity", async () => {
    vi.stubEnv("MELINDAOS_MCP_TOKEN_HASHES", `katt=${hashSecret(KATT)}, openbot=${hashSecret(OPENBOT).toUpperCase()}`);
    const katt = await authenticateMcp(request(KATT));
    const openbot = await authenticateMcp(request(OPENBOT));
    expect(katt).toMatchObject({ agentId: "ALL_ACCESS", mode: "master_token", credential: "katt" });
    expect(openbot).toMatchObject({ agentId: "ALL_ACCESS", mode: "master_token", credential: "openbot" });
  });

  it("keeps the legacy single hash working beside the map, as credential 'shared'", async () => {
    vi.stubEnv("MELINDAOS_MCP_TOKEN_HASH", hashSecret(SHARED));
    vi.stubEnv("MELINDAOS_MCP_TOKEN_HASHES", `katt=${hashSecret(KATT)}`);
    expect(await authenticateMcp(request(SHARED))).toMatchObject({ mode: "master_token", credential: "shared" });
    expect(await authenticateMcp(request(KATT))).toMatchObject({ mode: "master_token", credential: "katt" });
  });

  it("keeps the legacy raw token working when no hash is set", async () => {
    vi.stubEnv("MELINDAOS_MCP_TOKEN", SHARED);
    expect(await authenticateMcp(request(SHARED))).toMatchObject({ mode: "master_token", credential: "shared" });
  });

  it("rejects an unknown token with 401 and logs only a short fingerprint, never the token", async () => {
    vi.stubEnv("MELINDAOS_MCP_TOKEN_HASHES", `katt=${hashSecret(KATT)}`);
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const error = await rejection(authenticateMcp(request("stale-token-from-an-old-rotation")));
    expect(error.status).toBe(401);
    expect(error.message).toBe("Token MCP tidak valid.");
    const logged = info.mock.calls.map((call) => String(call[0])).join("\n");
    expect(logged).toContain(`"fingerprint":"${hashSecret("stale-token-from-an-old-rotation").slice(0, 8)}"`);
    expect(logged).toContain('"reason":"mismatch"');
    expect(logged).not.toContain("stale-token-from-an-old-rotation");
  });

  it("logs the reason when the bearer is empty", async () => {
    vi.stubEnv("MELINDAOS_MCP_TOKEN_HASHES", `katt=${hashSecret(KATT)}`);
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const error = await rejection(authenticateMcp(request("")));
    expect(error.status).toBe(401);
    expect(error.message).toBe("Token MCP kosong.");
    expect(info.mock.calls.map((call) => String(call[0])).join("\n")).toContain('"reason":"empty"');
  });

  it.each([
    ["a hash that is not 64 hex characters", "katt=abc123"],
    ["an entry without a name", `=${hashSecret(KATT)}`],
    ["a name with characters outside a-z, 0-9 and -", `Katt Bot=${hashSecret(KATT)}`],
    ["the same name twice", `katt=${hashSecret(KATT)},katt=${hashSecret(OPENBOT)}`],
    ["the same token under two names", `katt=${hashSecret(KATT)},dash=${hashSecret(KATT)}`],
    ["a reserved name", `shared=${hashSecret(KATT)}`],
  ])("fails closed with 503 when the map holds %s", async (_label, value) => {
    vi.stubEnv("MELINDAOS_MCP_TOKEN_HASH", hashSecret(SHARED));
    vi.stubEnv("MELINDAOS_MCP_TOKEN_HASHES", value);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const error = await rejection(authenticateMcp(request(SHARED)));
    expect(error.status).toBe(503);
    expect(error.message).toBe("Konfigurasi token MCP di server tidak valid.");
  });

  it("ignores blank entries and surrounding spaces", async () => {
    vi.stubEnv("MELINDAOS_MCP_TOKEN_HASHES", ` , katt = ${hashSecret(KATT)} ,, `);
    expect(await authenticateMcp(request(KATT))).toMatchObject({ credential: "katt" });
  });

  it("still requires a token in protected mode when nothing is configured", async () => {
    const error = await rejection(authenticateMcp(request(KATT)));
    expect(error.status).toBe(401);
    expect(error.message).toBe("Token MCP belum dikonfigurasi di server.");
  });

  it("names the credential 'local' in file mode", async () => {
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("MELINDAOS_DIRECTOR_STORE", undefined);
    expect(await authenticateMcp(request())).toMatchObject({ mode: "file", credential: "local" });
  });
});
