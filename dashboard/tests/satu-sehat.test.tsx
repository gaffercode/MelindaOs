// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SatuSehatView } from "@/components/satusehat/satu-sehat-view";
import type { MedifySnapshotResult } from "@/lib/medify/medify-snapshot-store";
import { SATUSEHAT_FHIR_RESOURCES } from "@/lib/satusehat/satu-sehat-data";
import { SATUSEHAT_FHIR_RESOURCE_NAMES } from "@/lib/satusehat/satusehat-oauth-client";
import type { SatusehatSnapshot } from "@/lib/satusehat/satusehat-snapshot-contract";
import type { SatusehatSnapshotResult } from "@/lib/satusehat/satusehat-snapshot-store";
import { snapshot } from "./fixtures/medify-snapshot";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/satu-sehat",
}));

const mockReadMedifySnapshot = vi.fn<() => Promise<MedifySnapshotResult>>();
vi.mock("@/lib/medify/medify-snapshot-store", () => ({
  readMedifySnapshot: () => mockReadMedifySnapshot(),
}));

const mockReadSatusehatSnapshot = vi.fn<() => Promise<SatusehatSnapshotResult>>();
vi.mock("@/lib/satusehat/satusehat-snapshot-store", () => ({
  readSatusehatSnapshot: () => mockReadSatusehatSnapshot(),
}));

const mockOauthConfigured = vi.fn<() => boolean>();
vi.mock("@/lib/satusehat/satusehat-oauth-client", async (original) => {
  const actual = await original<typeof import("@/lib/satusehat/satusehat-oauth-client")>();
  return { ...actual, satusehatOAuthConfigured: () => mockOauthConfigured() };
});

const { default: SatuSehatPage } = await import("@/app/satu-sehat/page");

const availableMedifyResult = (): MedifySnapshotResult => ({
  status: "current",
  snapshot: snapshot({ satusehatPercent: 44.8 }),
  receivedAt: "2099-01-15T02:35:00.000Z",
  checkedAt: "2099-01-15T03:00:00.000Z",
  message: null,
});

const missingMedifyResult = (): MedifySnapshotResult => ({
  status: "missing",
  snapshot: null,
  receivedAt: null,
  checkedAt: "2099-01-15T03:00:00.000Z",
  message: "Belum ada tarikan data Medify untuk tanggal ini.",
});

const missingSatusehatResult = (): SatusehatSnapshotResult => ({
  status: "missing",
  snapshot: null,
  receivedAt: null,
  checkedAt: "2099-01-15T03:00:00.000Z",
  message: "Belum ada tarikan otomatis Satu Sehat untuk tanggal ini.",
});

const liveSatusehatSnapshot = (): SatusehatSnapshot => ({
  schemaVersion: 1,
  date: "2099-01-15",
  environment: "production",
  organizationId: "100027810",
  facilityCode: "3571148",
  facilityName: "RS Ibu dan Anak Melinda",
  observedAt: "2099-01-15T02:15:00.000Z",
  periodStart: "2098-12-17",
  periodEnd: "2099-01-15",
  periodLabel: "2098-12-17 s.d. 2099-01-15 (30 hari)",
  source: "oauth2_fhir_api",
  logSummary: null,
  resources: SATUSEHAT_FHIR_RESOURCE_NAMES.map((name) => ({
    name,
    count:
      name === "Encounter"
        ? 910
        : name === "Composition"
          ? 850
          : name === "MedicationRequest"
            ? 6000
            : name === "MedicationDispense"
              ? 5900
              : name === "ServiceRequest"
                ? 500
                : name === "DiagnosticReport"
                  ? 480
                  : 120,
    status: "ok",
    periodMode: "rolling_30d",
  })),
  unavailableResources: [],
  provenance: {
    producer: "dashboard-sync",
    sourceObservedAt: "2099-01-15T02:15:00.000Z",
    periodStart: "2098-12-17",
    periodEnd: "2099-01-15",
    cutoff: null,
    sources: [{ name: "API SATUSEHAT Kemenkes", url: "https://api-satusehat.kemkes.go.id", note: "Agregat." }],
    notes: "",
  },
});

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  mockReadMedifySnapshot.mockResolvedValue(missingMedifyResult());
  mockReadSatusehatSnapshot.mockResolvedValue(missingSatusehatResult());
  mockOauthConfigured.mockReturnValue(false);
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Satu Sehat visualization view", () => {
  it("renders plain-language metrics, all 19 Kemenkes data types, care flows, and Rule 10118 diagnostics", () => {
    render(<SatuSehatView date="2026-11-19" medifyResult={missingMedifyResult()} />);

    const pageText = document.body.textContent ?? "";
    expect(screen.getByRole("heading", { level: 1, name: "Satu Sehat" })).not.toBeNull();
    for (const marker of ["77,1%", "131.548", "39.104", "170.604", "100027810", "3571148", "Rule 10118"]) {
      expect(pageText).toContain(marker);
    }

    for (const resource of SATUSEHAT_FHIR_RESOURCES) {
      expect(pageText).toContain(resource.plainTitle);
      expect(pageText).toContain(resource.name);
    }
    expect(SATUSEHAT_FHIR_RESOURCES).toHaveLength(19);
    expect(pageText).toContain("Alur kunjungan sampai resume medis pulang");
    expect(pageText).toContain("Alur permintaan sampai hasil laboratorium");
    expect(pageText).toContain("Laporan Medify belum tersedia");

    const charts = document.querySelectorAll("figure.medify-chart");
    expect(charts).toHaveLength(4);
    for (const chart of charts) {
      const svg = chart.querySelector('svg[role="img"]');
      expect(svg).not.toBeNull();
      expect(svg!.querySelector(".medify-chart-reference")).not.toBeNull();
      expect(svg!.querySelectorAll("rect")).toHaveLength(3);
      const curve = svg!.querySelector("path.medify-chart-line");
      expect(curve).not.toBeNull();
      expect(curve!.getAttribute("d")).toMatch(/\bC\s/);
    }
  });

  it("reconciles portal figures with an available Medify snapshot", () => {
    render(<SatuSehatView date="2099-01-15" medifyResult={availableMedifyResult()} />);
    const pageText = document.body.textContent ?? "";
    expect(pageText).toContain("44,8%");
    expect(pageText).toContain("556/561");
    expect(pageText).toContain("15 Jan 2099, 09:30 WIB");
  });

  it("filters the 19 data types by category", () => {
    render(<SatuSehatView date="2026-11-19" medifyResult={missingMedifyResult()} />);

    const resourceTable = screen.getByRole("table", {
      name: "Rincian 19 jenis data layanan di Portal Satu Sehat Kemenkes",
    });
    expect(within(resourceTable).getAllByRole("row")).toHaveLength(20); // 1 header + 19 data types

    fireEvent.click(screen.getByRole("button", { name: "Lab, USG & imunisasi (5)" }));
    const penunjangRows = within(resourceTable).getAllByRole("row");
    expect(penunjangRows).toHaveLength(6); // 1 header + 5 rows
    const penunjangText = resourceTable.textContent ?? "";
    expect(penunjangText).toContain("Hasil akhir pemeriksaan laboratorium");
    expect(penunjangText).toContain("Catatan imunisasi ibu & anak");
    expect(penunjangText).toContain("Hasil pemeriksaan USG & radiologi");
    expect(penunjangText).not.toContain("Serah terima obat di farmasi");

    fireEvent.click(screen.getByRole("button", { name: "Perlu perbaikan (8)" }));
    expect(within(resourceTable).getAllByRole("row")).toHaveLength(9); // 1 header + 8 warning/critical rows
  });

  it("copies the Director instruction summary with Organization ID and Rule 10118", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    render(<SatuSehatView date="2026-11-19" medifyResult={availableMedifyResult()} />);
    fireEvent.click(screen.getByRole("button", { name: "Salin ringkasan arahan" }));

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const copied = writeText.mock.calls[0][0] as string;
    expect(copied).toContain("100027810");
    expect(copied).toContain("Rule 10118");
    expect(copied).toContain("3571148");
    expect(copied).toContain("44.8%");
  });
});

describe("Satu Sehat server page & sidebar integration", () => {
  it("renders the Satu Sehat page inside DirectorShell with active sidebar link", async () => {
    vi.stubEnv("MELINDAOS_DIRECTOR_STORE", "file");
    mockReadMedifySnapshot.mockResolvedValue(availableMedifyResult());

    const element = await SatuSehatPage({ searchParams: Promise.resolve({}) });
    render(element);

    const nav = screen.getAllByRole("navigation", { name: "Navigasi utama" })[0];
    const satuSehatLink = within(nav).getByRole("link", { name: /Satu Sehat$/ });
    expect(satuSehatLink.getAttribute("href")).toBe("/satu-sehat");
    expect(satuSehatLink.getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("heading", { level: 1, name: "Satu Sehat" })).not.toBeNull();
  });

  it("renders live OAuth2 snapshot metrics honestly and triggers on-demand Kemenkes sync", async () => {
    const live = liveSatusehatSnapshot();
    const fetchMock = vi.fn<typeof fetch>(async (url) => {
      if (String(url).includes("/api/director/satusehat/sync")) {
        return Response.json(
          { snapshot: live, receipt: { id: "00000000-0000-4000-8000-000000000001", replayed: false } },
          { status: 201 },
        );
      }
      return Response.json({ csrfToken: "synthetic-csrf" });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <SatuSehatView
        date="2099-01-15"
        medifyResult={missingMedifyResult()}
        satusehatResult={missingSatusehatResult()}
        oauthConfigured={true}
      />,
    );

    expect(document.body.textContent ?? "").toContain("Kunci tersambung di server");
    fireEvent.click(screen.getByRole("button", { name: "Tarik data terbaru Kemenkes" }));

    await waitFor(() => {
      expect(document.body.textContent ?? "").toContain(
        "Data terbaru langsung dari sistem Kemenkes berhasil diperbarui tanpa CAPTCHA.",
      );
    });
    expect(document.body.textContent ?? "").toContain("Penarikan langsung aktif");
    expect(document.body.textContent ?? "").toContain("910");
  });
});
