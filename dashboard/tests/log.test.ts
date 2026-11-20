import { afterEach, describe, expect, it, vi } from "vitest";
import { logError } from "@/lib/log";
import { DirectorApiError } from "@/lib/director/director-api";
import { DirectorStoreError } from "@/lib/director/director-store";

describe("logError", () => {
  afterEach(() => vi.restoreAllMocks());

  it("logs code, error class and status without the message", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    logError("director_page_auth", new DirectorApiError(503, "Pasien Budi Santoso RM 001234"));
    expect(spy).toHaveBeenCalledOnce();
    const line = String(spy.mock.calls[0][0]);
    expect(JSON.parse(line)).toEqual({ level: "error", code: "director_page_auth", name: "DirectorApiError", status: 503 });
    expect(line).not.toContain("Budi");
  });

  it("logs the stable name of DirectorStoreError", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    logError("store", new DirectorStoreError(409, "conflict"));
    expect(JSON.parse(String(spy.mock.calls[0][0]))).toEqual({ level: "error", code: "store", name: "DirectorStoreError", status: 409 });
  });

  it("ignores a spoofed constructor name on plain objects", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    logError("spoof", { constructor: { name: "Budi" } });
    const line = String(spy.mock.calls[0][0]);
    expect(JSON.parse(line)).toEqual({ level: "error", code: "spoof", name: "Object" });
    expect(line).not.toContain("Budi");
  });

  it.each([["string", "boom"], ["null", null], ["plain object", { detail: "x" }]])("handles a thrown %s", (_label, value) => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    logError("odd_throw", value);
    expect(JSON.parse(String(spy.mock.calls[0][0]))).toEqual({ level: "error", code: "odd_throw", name: value === null ? "null" : typeof value === "object" ? "Object" : "string" });
  });
});
