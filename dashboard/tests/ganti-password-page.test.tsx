// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Principal } from "@/lib/access/access-control";

const required = vi.hoisted(() => ({ principal: null as Principal | null }));
vi.mock("@/lib/director/director-access", () => ({
  requirePagePermission: async () => ({ authenticated: true, principal: required.principal, allowedPages: ["/ganti-password"] }),
}));
vi.mock("@/components/access/change-password", () => ({ ChangePassword: () => <form aria-label="Ganti password" /> }));

const { default: ChangePasswordPage } = await import("@/app/ganti-password/page");

const forced: Principal = { kind: "account", id: "u1", role: "STAFF_FINANCE", displayName: "Dewi Sari", mustChange: true, csrfSecret: "x" };

afterEach(cleanup);

describe("forced password change page", () => {
  it("offers a way out: the account sign-out button sits beside the form, without the sidebar", async () => {
    required.principal = forced;
    render(await ChangePasswordPage());
    expect(screen.getByRole("button", { name: "Keluar" })).toBeTruthy();
    expect(screen.queryByRole("navigation", { name: "Navigasi utama" })).toBeNull();
  });
});
