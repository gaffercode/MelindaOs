// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChangePassword } from "@/components/access/change-password";
import type { PublicPrincipal } from "@/lib/access/access-control";

const ACCOUNT: PublicPrincipal = { kind: "account", role: "STAFF_FINANCE", displayName: "Dewi Sari", mustChange: false };
const FORCED: PublicPrincipal = { ...ACCOUNT, mustChange: true };
const DIRECTOR: PublicPrincipal = { kind: "director", role: "DIRECTOR", displayName: "Direktur", mustChange: false };
const NEW_PASSWORD = "password-baru-1234";

type Call = { url: string; method: string; headers: Record<string, string>; body: unknown };
const assign = vi.fn();
let calls: Call[];
let postReply: () => Promise<Response>;

beforeEach(() => {
  calls = []; assign.mockReset();
  postReply = () => Promise.resolve(Response.json({ returnTo: "/ruang-kerja", csrfToken: "csrf-new" }));
  vi.stubGlobal("location", { assign });
  vi.stubGlobal("fetch", vi.fn((url: string, init: RequestInit = {}) => {
    calls.push({ url, method: init.method ?? "GET", headers: (init.headers ?? {}) as Record<string, string>, body: typeof init.body === "string" ? JSON.parse(init.body) : undefined });
    if (url === "/api/access/session") return Promise.resolve(Response.json({ kind: "account", csrfToken: "csrf-1" }));
    if (url === "/api/access/password") return postReply();
    return Promise.resolve(Response.json({ error: "x" }, { status: 404 }));
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const posts = () => calls.filter((call) => call.method === "POST");
const fill = (current: string, next: string, again: string) => {
  fireEvent.change(screen.getByLabelText("Password saat ini"), { target: { value: current } });
  fireEvent.change(screen.getByLabelText("Password baru"), { target: { value: next } });
  fireEvent.change(screen.getByLabelText("Ulangi password baru"), { target: { value: again } });
  fireEvent.click(screen.getByRole("button", { name: "Simpan password" }));
};

describe("ChangePassword", () => {
  it("has the three labelled password fields and reads the CSRF token on load", async () => {
    render(<ChangePassword principal={ACCOUNT} />);
    for (const label of ["Password saat ini", "Password baru", "Ulangi password baru"]) expect(screen.getByLabelText(label).getAttribute("type")).toBe("password");
    await waitFor(() => expect(calls.map((call) => call.url)).toEqual(["/api/access/session"]));
  });

  it("explains the forced change when a temporary password is in use", () => {
    render(<ChangePassword principal={FORCED} />);
    expect(screen.getByText(/password sementara/i)).toBeTruthy();
  });

  it("refuses mismatched new passwords without sending anything", async () => {
    render(<ChangePassword principal={ACCOUNT} />);
    fill("lama-lama-1234", NEW_PASSWORD, `${NEW_PASSWORD}x`);
    expect((await screen.findByRole("alert")).textContent).toBe("Password baru tidak sama.");
    expect(posts()).toHaveLength(0);
  });

  it("refuses a new password shorter than 12 characters without sending anything", async () => {
    render(<ChangePassword principal={ACCOUNT} />);
    fill("lama-lama-1234", "pendek-11ch", "pendek-11ch");
    expect((await screen.findByRole("alert")).textContent).toBe("Password minimal 12 karakter.");
    expect(posts()).toHaveLength(0);
  });

  it("posts { currentPassword, newPassword } with X-CSRF-Token, then opens the returned path", async () => {
    render(<ChangePassword principal={FORCED} />);
    await waitFor(() => expect(calls).toHaveLength(1));
    fill("lama-lama-1234", NEW_PASSWORD, NEW_PASSWORD);
    await waitFor(() => expect(assign).toHaveBeenCalledWith("/ruang-kerja"));
    expect(posts()).toHaveLength(1);
    expect(posts()[0].url).toBe("/api/access/password");
    expect(posts()[0].headers["X-CSRF-Token"]).toBe("csrf-1");
    expect(posts()[0].body).toEqual({ currentPassword: "lama-lama-1234", newPassword: NEW_PASSWORD });
  });

  it("shows the server's message when the change is refused, and does not navigate", async () => {
    postReply = () => Promise.resolve(Response.json({ error: "Password saat ini tidak sesuai." }, { status: 400 }));
    render(<ChangePassword principal={ACCOUNT} />);
    await waitFor(() => expect(calls).toHaveLength(1));
    fill("salah-salah-1", NEW_PASSWORD, NEW_PASSWORD);
    expect((await screen.findByRole("alert")).textContent).toBe("Password saat ini tidak sesuai.");
    expect(assign).not.toHaveBeenCalled();
  });

  it("shows a fixed Indonesian message when the server cannot be reached", async () => {
    postReply = () => Promise.reject(new TypeError("Failed to fetch"));
    render(<ChangePassword principal={ACCOUNT} />);
    await waitFor(() => expect(calls).toHaveLength(1));
    fill("lama-lama-1234", NEW_PASSWORD, NEW_PASSWORD);
    expect((await screen.findByRole("alert")).textContent).toBe("Tidak dapat menghubungi server. Coba lagi.");
    expect(assign).not.toHaveBeenCalled();
  });

  it("shows a note instead of a form for the Director, whose passcode is not an account password", () => {
    render(<ChangePassword principal={DIRECTOR} />);
    expect(screen.getByText("Passcode Direktur diatur lewat konfigurasi server.")).toBeTruthy();
    expect(screen.queryByLabelText("Password baru")).toBeNull();
    expect(calls).toHaveLength(0);
  });
});
