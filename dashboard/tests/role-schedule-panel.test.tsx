// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RoleSchedulePanel } from "@/components/work-schedule/role-schedule-panel";
import { buildBaselineSchedule } from "@/lib/work-schedule/baseline-schedule";
import { buildEnrichedScheduleForRole } from "@/lib/work-schedule/fallbacks";

vi.mock("@/lib/client-api", () => ({ sessionResponse: async () => Response.json({}) }));

const date = "2026-11-19";
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("role schedule panel", () => {
  it("shows the server's schedule, with the Director's changes", async () => {
    const added = { id: "o1", date, role: "direktur" as const, kind: "add" as const, slotId: null, start: "06:00", end: "06:30", title: "Telepon yayasan", place: null, note: "", createdAt: "2026-11-19T01:00:00Z" };
    const { slots } = buildEnrichedScheduleForRole(date, "direktur", [], [added]);
    const urls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => { urls.push(url); return Response.json({ date, roleId: "direktur", slots }); });
    render(<RoleSchedulePanel date={date} />);
    await waitFor(() => expect(screen.getByText("Telepon yayasan")).toBeTruthy());
    expect(urls[0]).toBe(`/api/director/tasks/vault-feedback?date=${date}&role=direktur`);
    expect(screen.queryByText(/belum dapat dimuat/)).toBeNull();
  });

  it("falls back to the baseline and says so when the server cannot answer", async () => {
    vi.stubGlobal("fetch", async () => Response.json({ error: "Akses ditolak." }, { status: 403 }));
    render(<RoleSchedulePanel date={date} />);
    await waitFor(() => expect(screen.getByText(/belum dapat dimuat/)).toBeTruthy());
    expect(screen.getByText(buildBaselineSchedule(date, "direktur")[0].title)).toBeTruthy();
  });
});
