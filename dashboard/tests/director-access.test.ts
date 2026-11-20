import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const cookieGet = vi.fn();
const redirect = vi.fn((url: string) => { throw new Error(`REDIRECT:${url}`); });
const requireHuman = vi.fn();
const requireConfiguration = vi.fn();
const protectedMode = vi.fn();

vi.mock("next/headers", () => ({ cookies: async () => ({ get: cookieGet }) }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => redirect(url) }));
vi.mock("@/lib/director/director-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/director/director-api")>()),
  requireHuman: (...args: unknown[]) => requireHuman(...args),
  requireConfiguration: () => requireConfiguration(),
}));
vi.mock("@/lib/director/director-auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/director/director-auth")>()),
  protectedDirectorMode: () => protectedMode(),
}));

const { requireDirectorPage } = await import("@/lib/director/director-access");
const { DirectorApiError } = await import("@/lib/director/director-api");
const session = "a".repeat(64);

describe("requireDirectorPage", () => {
  beforeEach(() => {
    protectedMode.mockReturnValue(true);
    requireConfiguration.mockReturnValue({ origin: "https://director.test" });
    cookieGet.mockReturnValue(undefined);
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => vi.clearAllMocks());

  it("skips the gate in local mode", async () => {
    protectedMode.mockReturnValue(false);
    await expect(requireDirectorPage("/director-review")).resolves.toBe(false);
    expect(redirect).not.toHaveBeenCalled();
  });

  it("redirects to login when there is no session", async () => {
    requireHuman.mockRejectedValue(new DirectorApiError(401, "Silakan masuk sebagai Direktur."));
    await expect(requireDirectorPage("/director-review")).rejects.toThrow("REDIRECT:/director-login?returnTo=%2Fdirector-review");
  });

  it("redirects to login when the session expired", async () => {
    cookieGet.mockReturnValue({ value: session });
    requireHuman.mockRejectedValue(new DirectorApiError(401, "Sesi berakhir. Silakan masuk kembali."));
    await expect(requireDirectorPage("/knowledge")).rejects.toThrow("REDIRECT:/director-login?returnTo=%2Fknowledge");
  });

  it("allows a valid session and forwards only the session cookie", async () => {
    cookieGet.mockReturnValue({ value: session });
    requireHuman.mockResolvedValue({ raw: session, reviewerId: "director" });
    await expect(requireDirectorPage("/")).resolves.toBe(true);
    const request = requireHuman.mock.calls[0][0] as Request;
    expect(request.headers.get("Cookie")).toBe(`melinda_director=${session}`);
  });

  it("surfaces broken configuration instead of looping to login", async () => {
    const failure = new DirectorApiError(503, "API pengiriman belum diaktifkan.");
    requireConfiguration.mockImplementation(() => { throw failure; });
    await expect(requireDirectorPage("/")).rejects.toBe(failure);
    expect(redirect).not.toHaveBeenCalled();
    expect(String(vi.mocked(console.error).mock.calls[0][0])).toContain('"code":"director_page_auth"');
  });

  it("surfaces store outages instead of looping to login", async () => {
    cookieGet.mockReturnValue({ value: session });
    requireHuman.mockRejectedValue(new Error("fetch failed"));
    await expect(requireDirectorPage("/")).rejects.toThrow("fetch failed");
    expect(redirect).not.toHaveBeenCalled();
  });
});
