import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBucket, listDocuments, parseArgs, uploadAll, verifyAll } from "../scripts/kredensial-upload.mjs";

const origin = "https://project.supabase.co";
const secret = "sb_secret_test";
let source: string;

beforeEach(() => {
  source = mkdtempSync(join(tmpdir(), "kredensial-"));
  mkdirSync(join(source, "01_PERSYARATAN_MUTLAK"));
  mkdirSync(join(source, "08_CP", "12_CP_Prioritas"), { recursive: true });
  mkdirSync(join(source, "assets"));
  writeFileSync(join(source, "01_PERSYARATAN_MUTLAK", "01.01_Surat.pdf"), Buffer.alloc(10, 1));
  writeFileSync(join(source, "01_PERSYARATAN_MUTLAK", "01.04_Rekap.xlsx"), Buffer.alloc(20, 2));
  writeFileSync(join(source, "01_PERSYARATAN_MUTLAK", "01.05_NPWP.jpg"), Buffer.alloc(30, 3));
  writeFileSync(join(source, "08_CP", "12_CP_Prioritas", "08.01_CP.pdf"), Buffer.alloc(40, 4));
  writeFileSync(join(source, "index.html"), "<html>");
  writeFileSync(join(source, "documents_index.json"), "{}");
  writeFileSync(join(source, "pdf-viewer.html"), "<html>");
  writeFileSync(join(source, "assets", "logo.png"), Buffer.alloc(5));
});
afterEach(() => rmSync(source, { recursive: true, force: true }));

describe("listDocuments", () => {
  it("walks the source folder and keeps only PDF, XLSX and JPG documents, sorted", () => {
    expect(listDocuments(source)).toEqual([
      { path: "01_PERSYARATAN_MUTLAK/01.01_Surat.pdf", bytes: 10, contentType: "application/pdf" },
      { path: "01_PERSYARATAN_MUTLAK/01.04_Rekap.xlsx", bytes: 20, contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
      { path: "01_PERSYARATAN_MUTLAK/01.05_NPWP.jpg", bytes: 30, contentType: "image/jpeg" },
      { path: "08_CP/12_CP_Prioritas/08.01_CP.pdf", bytes: 40, contentType: "application/pdf" },
    ]);
  });
});

describe("parseArgs", () => {
  it("reads the source folder and flags, defaulting to a dry run of nothing", () => {
    expect(parseArgs(["--source", "public/kredensial", "--dry-run"])).toEqual({ source: "public/kredensial", dryRun: true, createBucket: false, verify: false, concurrency: 3 });
    expect(parseArgs(["--source", "x", "--create-bucket", "--verify", "--concurrency", "2"])).toMatchObject({ createBucket: true, verify: true, concurrency: 2 });
    expect(() => parseArgs([])).toThrow(/--source/);
    expect(() => parseArgs(["--source", "x", "--bogus"])).toThrow(/--bogus/);
  });
});

describe("uploadAll", () => {
  it("PUTs each document to the private bucket with upsert and the right content type, at most N at a time", async () => {
    let inFlight = 0, peak = 0;
    const transport = vi.fn(async (_url: URL | RequestInfo, init?: RequestInit) => {
      inFlight += 1; peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      expect(init?.headers).toMatchObject({ apikey: secret, Authorization: `Bearer ${secret}`, "x-upsert": "true" });
      return Response.json({ Key: "kredensial/x" });
    });
    const result = await uploadAll(listDocuments(source), { source, origin, secret, transport, concurrency: 2 });
    expect(result).toEqual({ uploaded: 4, bytes: 100, failed: [] });
    expect(peak).toBe(2);
    const targets = transport.mock.calls.map(([url]) => url).sort();
    expect(targets[0]).toBe(`${origin}/storage/v1/object/kredensial/01_PERSYARATAN_MUTLAK/01.01_Surat.pdf`);
    const pdf = transport.mock.calls.find(([url]) => String(url).endsWith("01.01_Surat.pdf"))?.[1] as RequestInit;
    expect(pdf.method).toBe("POST");
    expect((pdf.headers as Record<string, string>)["Content-Type"]).toBe("application/pdf");
    expect(Buffer.from(pdf.body as Uint8Array).byteLength).toBe(10);
  });

  it("reports failures by path instead of throwing halfway", async () => {
    const transport = vi.fn(async (url: URL | RequestInfo) => (String(url).endsWith(".xlsx") ? new Response("denied", { status: 403 }) : Response.json({})));
    const result = await uploadAll(listDocuments(source), { source, origin, secret, transport, concurrency: 1 });
    expect(result.uploaded).toBe(3);
    expect(result.failed).toEqual([{ path: "01_PERSYARATAN_MUTLAK/01.04_Rekap.xlsx", status: 403 }]);
  });
});

describe("createBucket", () => {
  it("creates a private bucket and treats an existing one as success", async () => {
    const transport = vi.fn(async () => Response.json({ name: "kredensial" }));
    expect(await createBucket({ origin, secret, transport })).toBe("created");
    const [url, init] = transport.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${origin}/storage/v1/bucket`);
    expect(JSON.parse(String(init.body))).toEqual({ id: "kredensial", name: "kredensial", public: false });
    transport.mockResolvedValue(new Response(JSON.stringify({ error: "Duplicate", statusCode: "409" }), { status: 409 }));
    expect(await createBucket({ origin, secret, transport })).toBe("exists");
    transport.mockResolvedValue(new Response("x", { status: 500 }));
    await expect(createBucket({ origin, secret, transport })).rejects.toThrow(/500/);
  });
});

describe("verifyAll", () => {
  it("lists each folder in the bucket and compares sizes with the local files", async () => {
    const transport = vi.fn(async (_url: URL | RequestInfo, init?: RequestInit) => {
      const { prefix } = JSON.parse(String(init?.body)) as { prefix: string };
      const rows = listDocuments(source).filter((doc) => doc.path.startsWith(`${prefix}/`)).map((doc) => ({ name: doc.path.slice(prefix.length + 1), metadata: { size: doc.path.endsWith(".jpg") ? 1 : doc.bytes } }));
      return Response.json(rows);
    });
    const result = await verifyAll(listDocuments(source), { origin, secret, transport });
    expect(result).toEqual({ matched: 3, mismatched: ["01_PERSYARATAN_MUTLAK/01.05_NPWP.jpg"], missing: [] });
    expect(transport.mock.calls.every(([url]) => url === `${origin}/storage/v1/object/list/kredensial`)).toBe(true);
  });
});
