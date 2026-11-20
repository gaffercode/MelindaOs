// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PharmacyOrderView, type InitialOrderFile } from "@/components/pharmacy/pharmacy-order-view";
import type { OrderFile, OrderFileDetail, OrderFileList } from "@/lib/pharmacy/order-obat-api";
import { readOrderGrid } from "@/lib/pharmacy/order-obat-reading";
import { ORDER_GRID } from "./helpers/xlsx-fixture";

vi.mock("@/lib/client-api", () => ({ directorCsrfHeaders: async () => ({ "x-test-csrf": "token" }) }));

const XLSX_NOTICE = "Susunan kolom XLSX ini tidak dikenali sebagai lembar pengajuan. Pemeriksaan sistem tidak dijalankan. Buka berkasnya untuk membaca langsung.";
const LOADING = "Memuat isi berkas…";
const FAILED = "Isi berkas gagal dimuat. Muat ulang halaman untuk mencoba lagi.";

function orderFile(id: string, kind: OrderFile["kind"], fileName: string): OrderFile {
  return { key: `upload:${id}`, source: "upload", id, uploadedAt: "2026-11-09T09:00:00+07:00", uploadedBy: "direktur", fileName, contentType: "application/octet-stream", byteSize: 2048, kind, note: null, parsedFormat: null };
}
const sheet = orderFile("1", "pdf", "lembar.pdf");
const workbook = orderFile("7", "xlsx", "order-desember.xlsx");
const reading = readOrderGrid(ORDER_GRID);
const initialSheet: InitialOrderFile = { order: sheet, parsed: reading };
const listOf = (orders: OrderFile[]): OrderFileList => ({ orders, decisions: {}, uploads: true, storeNotice: null });

/** Answers the list request and each file request; a route may return a promise the test resolves later. */
function serve(routes: Record<string, () => Response | Promise<Response>>) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const route = routes[url];
    if (!route) throw new Error(`unexpected request ${url}`);
    return route();
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}
const requestsTo = (fetchMock: ReturnType<typeof serve>, url: string) => fetchMock.mock.calls.filter(([input]) => String(input) === url).length;

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("order obat page: loading a file's content", () => {
  it("shows the loading text while a clicked file loads, then the notice for what came back", async () => {
    let release: (response: Response) => void = () => undefined;
    const pending = new Promise<Response>((resolve) => { release = resolve; });
    serve({ "/api/director/order-obat/berkas": () => Response.json(listOf([workbook, sheet])), "/api/director/order-obat/berkas/7": () => pending });
    render(<PharmacyOrderView initialFiles={[initialSheet]} />);
    const button = await screen.findByRole("button", { name: workbook.fileName });
    expect(screen.queryByText(LOADING)).toBeNull();
    fireEvent.click(button);
    expect(await screen.findByText(LOADING)).toBeTruthy();
    expect(screen.queryByText(/Pemeriksaan sistem tidak dijalankan/)).toBeNull();
    const detail: OrderFileDetail = { order: workbook, parsed: null };
    await act(async () => { release(Response.json(detail)); });
    expect(await screen.findByText(XLSX_NOTICE)).toBeTruthy();
    expect(screen.queryByText(LOADING)).toBeNull();
  });

  it("loads the content of a file the list selects by itself", async () => {
    const fetchMock = serve({ "/api/director/order-obat/berkas": () => Response.json(listOf([workbook])), "/api/director/order-obat/berkas/7": () => Response.json({ order: workbook, parsed: null }) });
    render(<PharmacyOrderView initialFiles={[]} />);
    expect(await screen.findByText(XLSX_NOTICE)).toBeTruthy();
    expect(requestsTo(fetchMock, "/api/director/order-obat/berkas/7")).toBe(1);
  });

  it("says in the panel when the content failed to load, and does not ask again by itself", async () => {
    const fetchMock = serve({ "/api/director/order-obat/berkas": () => Response.json(listOf([workbook])), "/api/director/order-obat/berkas/7": () => new Response(null, { status: 500 }) });
    render(<PharmacyOrderView initialFiles={[]} />);
    expect(await screen.findByText(FAILED)).toBeTruthy();
    expect(screen.queryByText(LOADING)).toBeNull();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    expect(requestsTo(fetchMock, "/api/director/order-obat/berkas/7")).toBe(1);
  });
});

describe("order obat page: upload status", () => {
  async function uploadAnswer(detail: OrderFileDetail) {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") return Response.json({ ...detail, replayed: false }, { status: 201 });
      if (String(input) === "/api/director/order-obat/berkas") return Response.json(listOf([detail.order]));
      return Response.json(detail);
    }));
    const { container } = render(<PharmacyOrderView initialFiles={[]} uploadsEnabled />);
    const input = screen.getByLabelText("Pilih berkas pengajuan");
    fireEvent.change(input, { target: { files: [new File(["a,b\n1,2\n"], detail.order.fileName)] } });
    const form = container.querySelector("form");
    if (!form) throw new Error("no upload form");
    await act(async () => { fireEvent.submit(form); });
    await waitFor(() => expect(screen.getByRole("status").textContent).not.toContain("Mengunggah"));
    return screen.getByRole("status").textContent;
  }

  it("does not say an unrecognised CSV was read", async () => {
    const csv = orderFile("8", "csv", "lain.csv");
    const status = await uploadAnswer({ order: csv, parsed: { format: "csv", table: { header: ["a", "b"], rows: [["1", "2"]], delimiter: "," } } });
    expect(status).toBe("lain.csv tersimpan; isinya tidak dikenali sebagai lembar pengajuan.");
  });

  it("says a recognised sheet was read", async () => {
    const csv = orderFile("9", "csv", "pengajuan.csv");
    const status = await uploadAnswer({ order: csv, parsed: reading });
    expect(status).toBe("pengajuan.csv tersimpan dan terbaca.");
  });
});
