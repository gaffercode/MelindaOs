// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MelindaProposal } from "@/components/melinda/melinda-proposal";

vi.mock("@/lib/client-api", () => ({ directorCsrfHeaders: async () => ({ "X-CSRF-Token": "csrf-test" }) }));

const proposal = { id: "00000000-0000-4000-8000-000000000001", kind: "ganti_pic" as const, summary: "Ganti PIC ACT-1: PIC Lama → PIC Baru. Status tetap berjalan.", expiresAt: "2026-11-19T02:15:00Z" };
let requests: { url: string; init: RequestInit }[];
let reply: () => Response;

beforeEach(() => {
  requests = [];
  reply = () => Response.json({ status: "executed", message: "PIC ACT-1 sekarang PIC Baru (IOC-6000)." });
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => { requests.push({ url, init }); return reply(); });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("Melinda proposal card", () => {
  it("shows the change and sends nothing until Konfirmasi", async () => {
    render(<MelindaProposal proposal={proposal} />);
    expect(screen.getByText(proposal.summary)).toBeTruthy();
    expect(screen.getByText(/menunggu konfirmasi/)).toBeTruthy();
    expect(requests).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "Konfirmasi" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("IOC-6000"));
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe(`/api/melinda/actions/${proposal.id}`);
    expect(requests[0].init.method).toBe("POST");
    expect((requests[0].init.headers as Record<string, string>)["X-CSRF-Token"]).toBe("csrf-test");
    expect(JSON.parse(String(requests[0].init.body))).toEqual({ decision: "confirm" });
    expect(screen.queryByRole("button", { name: "Konfirmasi" })).toBeNull();
  });

  it("sends Batal and shows an expired proposal as decided", async () => {
    reply = () => Response.json({ status: "cancelled", message: "Usulan dibatalkan." });
    render(<MelindaProposal proposal={proposal} />);
    fireEvent.click(screen.getByRole("button", { name: "Batal" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Usulan dibatalkan."));
    expect(JSON.parse(String(requests[0].init.body))).toEqual({ decision: "cancel" });

    cleanup();
    reply = () => Response.json({ error: "Usulan sudah kedaluwarsa. Minta Melinda menyiapkannya lagi." }, { status: 409 });
    render(<MelindaProposal proposal={proposal} />);
    fireEvent.click(screen.getByRole("button", { name: "Konfirmasi" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("kedaluwarsa"));
    expect(screen.queryByRole("button", { name: "Konfirmasi" })).toBeNull();
  });

  it("keeps the buttons after a network failure so the Director can try again", async () => {
    vi.stubGlobal("fetch", async () => { throw new Error("offline"); });
    render(<MelindaProposal proposal={proposal} />);
    fireEvent.click(screen.getByRole("button", { name: "Konfirmasi" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Coba lagi"));
    expect((screen.getByRole("button", { name: "Konfirmasi" }) as HTMLButtonElement).disabled).toBe(false);
  });
});
