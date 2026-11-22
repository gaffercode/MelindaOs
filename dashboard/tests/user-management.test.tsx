// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UserManagement } from "@/components/access/user-management";
import { ACCOUNT_ROLES, ROLE_LABELS } from "@/lib/access/access-control";

const USER = { id: "0b6f7b8e-2f5c-4c53-9d63-0a5f2f6a1111", email: "dewi@example.test", displayName: "Dewi Sari", role: "STAFF_FINANCE", mustChange: false, disabled: false, updatedAt: "2026-11-12T03:00:00Z" };
const TEMP = "Tmp-Pass-0123456789xy";

type Call = { url: string; method: string; headers: Record<string, string>; body: unknown };
let calls: Call[];
let users: typeof USER[];
let createStatus: number;

function fetchMock(url: string, init: RequestInit = {}): Promise<Response> {
  const method = init.method ?? "GET";
  const headers = (init.headers ?? {}) as Record<string, string>;
  calls.push({ url, method, headers, body: typeof init.body === "string" ? JSON.parse(init.body) : undefined });
  if (url === "/api/director/session") return Promise.resolve(Response.json({ csrfToken: "csrf-test" }));
  if (url === "/api/access/users" && method === "GET") return Promise.resolve(Response.json({ users }));
  if (url === "/api/access/audit") return Promise.resolve(Response.json({ events: [
    { actor: "director", action: "user_create", target: "dewi@example.test", createdAt: "2026-11-12T03:00:00Z" },
    { actor: USER.id, action: "user_disable", target: USER.id, createdAt: "2026-11-12T04:00:00Z" },
  ] }));
  if (url === "/api/access/users" && method === "POST") {
    if (createStatus === 409) return Promise.resolve(Response.json({ error: "Email sudah terdaftar." }, { status: 409 }));
    users = [...users, { ...USER, id: "0b6f7b8e-2f5c-4c53-9d63-0a5f2f6a2222", email: "baru@example.test", displayName: "Baru", mustChange: true }];
    return Promise.resolve(Response.json({ user: users[users.length - 1], temporaryPassword: TEMP }, { status: 201 }));
  }
  if (url.endsWith("/password")) {
    users = users.map((user) => ({ ...user, mustChange: true, updatedAt: "2026-11-12T05:00:00Z" }));
    return Promise.resolve(Response.json({ temporaryPassword: TEMP }));
  }
  if (method === "PATCH") {
    users = users.map((user) => ({ ...user, disabled: true }));
    return Promise.resolve(Response.json({ user: users[0] }));
  }
  return Promise.resolve(Response.json({ error: "x" }, { status: 404 }));
}

beforeEach(() => {
  calls = []; users = [USER]; createStatus = 201;
  vi.stubGlobal("fetch", vi.fn(fetchMock));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const fill = (role: string | null = "STAFF_HR") => {
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: "baru@example.test" } });
  fireEvent.change(screen.getByLabelText("Nama"), { target: { value: "Baru" } });
  if (role) fireEvent.change(screen.getByLabelText("Peran"), { target: { value: role } });
  fireEvent.click(screen.getByRole("button", { name: "Buat akun" }));
};

describe("user management", () => {
  it("lists accounts with Email, Nama, Peran, Status, Diubah and the audit", async () => {
    render(<UserManagement />);
    expect(await screen.findByText("dewi@example.test")).toBeTruthy();
    for (const name of ["Email", "Nama", "Peran", "Status", "Diubah"]) expect(screen.getByRole("columnheader", { name })).toBeTruthy();
    expect(within(screen.getByRole("table")).getByText(ROLE_LABELS.STAFF_FINANCE)).toBeTruthy();
    expect(await screen.findByRole("heading", { name: "Audit" })).toBeTruthy();
    expect(await screen.findByText(/Akun dibuat/)).toBeTruthy();
    // Actors: the Director's reviewer id shows "Direktur"; an account UUID shows that account's email, never the raw id.
    expect(await screen.findByText(/oleh Direktur/)).toBeTruthy();
    expect(screen.getByText(/oleh dewi@example\.test/)).toBeTruthy();
    expect(document.body.textContent).not.toContain(USER.id);
  });

  it("offers exactly the six account roles, never Direktur", () => {
    render(<UserManagement />);
    const all = within(screen.getByLabelText("Peran")).getAllByRole("option") as HTMLOptionElement[];
    expect(all[0].textContent).toBe("Pilih peran");
    expect(all[0].value).toBe("");
    const options = all.filter((option) => option.value !== "").map((option) => option.textContent);
    expect(options).toEqual(ACCOUNT_ROLES.map((role) => ROLE_LABELS[role]));
    expect(options).toHaveLength(6);
    expect(options).not.toContain("Direktur");
  });

  it("does not submit until a role is chosen", async () => {
    render(<UserManagement />);
    await screen.findByText("dewi@example.test");
    fill(null);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(calls.some((call) => call.method === "POST")).toBe(false);
  });

  it("creates an account with the CSRF token and shows the temporary password once", async () => {
    render(<UserManagement />);
    await screen.findByText("dewi@example.test");
    fill();
    expect(await screen.findByText(TEMP)).toBeTruthy();
    const post = calls.find((call) => call.method === "POST" && call.url === "/api/access/users");
    expect(post?.body).toEqual({ email: "baru@example.test", displayName: "Baru", role: "STAFF_HR" });
    expect(post?.headers["X-CSRF-Token"]).toBe("csrf-test");
    fireEvent.click(screen.getByRole("button", { name: "Tutup" }));
    expect(screen.queryByText(TEMP)).toBeNull();
    expect(document.body.textContent).not.toContain(TEMP);
  });

  it("copies the temporary password with Salin", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    render(<UserManagement />);
    await screen.findByText("dewi@example.test");
    fill();
    await screen.findByText(TEMP);
    fireEvent.click(screen.getByRole("button", { name: "Salin" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(TEMP));
  });

  it("shows the duplicate email message as an alert and no password", async () => {
    createStatus = 409;
    render(<UserManagement />);
    await screen.findByText("dewi@example.test");
    fill();
    expect((await screen.findByRole("alert")).textContent).toBe("Email sudah terdaftar.");
    expect(screen.queryByText(TEMP)).toBeNull();
  });

  it("disables an account with PATCH and the CSRF token", async () => {
    render(<UserManagement />);
    await screen.findByText("dewi@example.test");
    fireEvent.click(screen.getByRole("button", { name: "Nonaktifkan" }));
    await waitFor(() => expect(calls.some((call) => call.method === "PATCH")).toBe(true));
    const patch = calls.find((call) => call.method === "PATCH");
    expect(patch?.url).toBe(`/api/access/users/${USER.id}`);
    expect(patch?.body).toEqual({ disabled: true });
    expect(patch?.headers["X-CSRF-Token"]).toBe("csrf-test");
    expect(await screen.findByRole("button", { name: "Aktifkan" })).toBeTruthy();
  });

  it("resets a password and shows the new temporary password once", async () => {
    render(<UserManagement />);
    await screen.findByText("dewi@example.test");
    fireEvent.click(screen.getByRole("button", { name: "Reset password" }));
    expect(await screen.findByText(TEMP)).toBeTruthy();
    const post = calls.find((call) => call.url === `/api/access/users/${USER.id}/password`);
    expect(post?.method).toBe("POST");
    expect(post?.headers["X-CSRF-Token"]).toBe("csrf-test");
    // The row is re-read: the account now must change its password.
    await waitFor(() => expect(within(screen.getByRole("table")).getByText("Aktif, belum ganti password")).toBeTruthy());
    expect(within(screen.getByRole("table")).getByText(/12[.:]00/)).toBeTruthy();
  });

  it("shows a fixed Indonesian message when the network fails", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))));
    render(<UserManagement />);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("Tidak dapat menghubungi server. Coba lagi.");
    expect(document.body.textContent).not.toContain("Failed to fetch");
  });

  it("renders without crashing when the API is unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(Response.json({ error: "Akun belum diaktifkan." }, { status: 503 }))));
    render(<UserManagement />);
    expect((await screen.findByRole("alert")).textContent).toContain("Akun belum diaktifkan.");
  });
});
