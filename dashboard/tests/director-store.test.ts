import { describe, expect, it } from "vitest";
import { SupabaseDirectorStore, DirectorStoreError, canonicalHash } from "@/lib/director/director-store";

describe("Supabase director storage boundary", () => {
  it("hashes object contents independently of JSON key ordering", () => {
    expect(canonicalHash({ b: 2, a: { y: 0, x: null } })).toBe(canonicalHash({ a: { x: null, y: 0 }, b: 2 }));
    expect(canonicalHash({ a: 0 })).not.toBe(canonicalHash({ a: null }));
  });
  it("uses a server-only authenticated RPC with no cache and no redirect", async () => {
    let observed: Request | undefined;
    const store = new SupabaseDirectorStore("https://synthetic.supabase.co", "sb_secret_test-only", async (url, init) => {
      observed = new Request(url, init);
      return Response.json({ published: null });
    });
    expect(await store.call("published", { date: "2026-10-03" })).toEqual({ published: null });
    expect(observed?.url).toBe("https://synthetic.supabase.co/rest/v1/rpc/melinda_director");
    expect(observed?.headers.get("apikey")).toBe("sb_secret_test-only");
    expect(observed?.redirect).toBe("error");
    expect(observed?.cache).toBe("no-store");
    expect(await observed?.json()).toEqual({ command: "published", args: { date: "2026-10-03" } });
  });
  it("redacts downstream errors and preserves explicit application conflicts", async () => {
    const failing = new SupabaseDirectorStore("https://synthetic.supabase.co", "sb_secret_test-only", async () => new Response("private source and token", { status: 500 }));
    await expect(failing.call("published", {})).rejects.toThrow("Penyimpanan laporan belum tersedia.");
    const conflict = new SupabaseDirectorStore("https://synthetic.supabase.co", "sb_secret_test-only", async () => Response.json({ errorCode: "conflict" }));
    await expect(conflict.call("submit", {})).rejects.toMatchObject<Partial<DirectorStoreError>>({ status: 409 });
  });
  it.each([
    [401, "unauthorized"],
    [403, "unauthorized"],
    [404, "missing_function"],
    [400, "rejected"],
    [409, "rejected"],
    [422, "rejected"],
    [429, "unreachable"],
    [500, "unreachable"],
    [502, "unreachable"],
    [503, "unreachable"],
  ])("reports HTTP %i as %s without reading the response body", async (status, code) => {
    const unreadable = new Response(null, { status });
    const trap = () => { throw new Error("body must not be read"); };
    Object.defineProperties(unreadable, { text: { value: trap }, json: { value: trap } });
    const store = new SupabaseDirectorStore("https://synthetic.supabase.co", "sb_secret_test-only", async () => unreadable);
    await expect(store.call("published", {})).rejects.toMatchObject<Partial<DirectorStoreError>>({ status: 503, code, message: "Penyimpanan laporan belum tersedia." });
  });
  it.each([
    ["a rejected transport", new TypeError("fetch failed")],
    ["a timed-out transport", new DOMException("The operation timed out.", "TimeoutError")],
  ])("reports %s as unreachable", async (_label, failure) => {
    const store = new SupabaseDirectorStore("https://synthetic.supabase.co", "sb_secret_test-only", async () => { throw failure; });
    await expect(store.call("published", {})).rejects.toMatchObject<Partial<DirectorStoreError>>({ status: 503, code: "unreachable", message: "Penyimpanan laporan belum tersedia." });
  });
  it.each([
    ["a non-JSON body", () => new Response("<html>gateway</html>", { status: 200 })],
    ["a JSON array", () => Response.json([])],
    ["a JSON null", () => Response.json(null)],
  ])("reports %s on an OK response as invalid_response", async (_label, respond) => {
    const store = new SupabaseDirectorStore("https://synthetic.supabase.co", "sb_secret_test-only", async () => respond());
    await expect(store.call("published", {})).rejects.toMatchObject<Partial<DirectorStoreError>>({ status: 503, code: "invalid_response" });
  });
  it("keeps the application errorCode path and its statuses", async () => {
    const missing = new SupabaseDirectorStore("https://synthetic.supabase.co", "sb_secret_test-only", async () => Response.json({ errorCode: "not_found" }));
    await expect(missing.call("get", {})).rejects.toMatchObject<Partial<DirectorStoreError>>({ status: 404, code: "not_found" });
    const odd = new SupabaseDirectorStore("https://synthetic.supabase.co", "sb_secret_test-only", async () => Response.json({ errorCode: 7 }));
    await expect(odd.call("get", {})).rejects.toMatchObject<Partial<DirectorStoreError>>({ status: 503, code: "invalid_response" });
  });
  it("can call the schema status RPC", async () => {
    let observed: string | undefined;
    const store = new SupabaseDirectorStore("https://synthetic.supabase.co", "sb_secret_test-only", async (url) => {
      observed = String(url);
      return Response.json({ ok: true });
    });
    await store.call("status", {}, "melinda_schema_status");
    expect(observed).toBe("https://synthetic.supabase.co/rest/v1/rpc/melinda_schema_status");
  });
  it("rejects insecure, credential-bearing or path-bearing storage origins", () => {
    for (const url of ["http://remote.example", "https://user:pass@example.com", "https://example.com/other", "https://example.com/?key=secret"]) {
      expect(() => new SupabaseDirectorStore(url, "sb_secret_test-only")).toThrow();
    }
  });
});
