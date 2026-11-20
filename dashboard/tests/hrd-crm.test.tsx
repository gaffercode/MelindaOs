import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CrmView } from "@/components/crm/crm-view";
import { HrdView } from "@/components/hrd/hrd-view";
import { childrenOf, formatPhone, whatsappHref } from "@/lib/hrd/hrd-data";
import { loadHrdDirectory, parseDirectory, type HrdDirectory } from "@/lib/hrd/hrd-directory";
import { NETWORK_TOTAL, PARTNER_NETWORK, daysSince, initials } from "@/lib/crm/crm-data";
import { fullName } from "@/lib/staff-data";

// The real directory lives in the private Supabase bucket `hrd`; tests use only the fictional sample.
const sampleJson = JSON.parse(readFileSync(join(process.cwd(), "data", "synthetic", "hrd-directory.json"), "utf8"));
const parsedSample = parseDirectory(sampleJson);
if (!parsedSample) throw new Error("data/synthetic/hrd-directory.json has the wrong shape");
const sample: HrdDirectory = { ...parsedSample, source: "sample", version: "0".repeat(64) };
const { officials, staff } = sample;

describe("HRD page", () => {
  it("draws every official once in the tree and in the directory", () => {
    const html = renderToStaticMarkup(<HrdView directory={sample} />);
    expect(html.match(/class="org-card"/g)).toHaveLength(officials.length);
    expect(html.match(/Kirim WhatsApp ke/g)).toHaveLength(officials.length);
    expect(childrenOf(officials, "direktur").map((o) => o.id)).toEqual(["wadir-sdm-keuangan", "wadir-operasional"]);
  });
  it("formats numbers and WhatsApp links", () => {
    expect(formatPhone("+6281200000001")).toBe("+62 812-0000-0001");
    expect(whatsappHref("+6281200000001")).toBe("https://wa.me/6281200000001");
  });
  it("labels the fictional sample as such, and only the sample", () => {
    expect(renderToStaticMarkup(<HrdView directory={sample} />)).toContain("Data contoh fiktif");
    expect(renderToStaticMarkup(<HrdView directory={{ ...sample, source: "supabase" }} />)).not.toContain("Data contoh fiktif");
  });
});

describe("CRM page", () => {
  it("shows an honest empty state without sample data", () => {
    const html = renderToStaticMarkup(<CrmView />);
    expect(html).toContain("Belum ada mitra yang dilacak.");
    expect(html).toContain("Belum ada data rujukan.");
  });
  it("lists the partner network from the source document", () => {
    const [bidan, puskesmas, perusahaan] = PARTNER_NETWORK;
    expect([bidan.names.length, puskesmas.names.length, perusahaan.names.length]).toEqual([25, 6, 25]);
    expect(NETWORK_TOTAL).toBe(56);
    const html = renderToStaticMarkup(<CrmView />);
    expect(html.match(/class="crm-chip"/g)).toHaveLength(56);
    expect(html).toContain("Puskesmas Tarokan");
    expect(html).toContain("BPJS Kesehatan");
    expect(initials("Ema Kristianingsih")).toBe("EK");
    expect(initials("Tiara")).toBe("TI");
  });
  it("counts idle days from the last contact", () => {
    expect(daysSince("2026-11-01", new Date("2026-11-09T05:00:00Z"))).toBe(8);
    expect(daysSince(null, new Date())).toBeNull();
  });
});

describe("HRD staff directory", () => {
  it("lists every staff member once, titles around the name, and no payroll data", () => {
    const html = renderToStaticMarkup(<HrdView directory={sample} />);
    expect(new Set(staff.map((p) => p.name)).size).toBe(staff.length);
    expect(html).toContain("dr. Contoh Dokter Spesialis, Sp.OG");
    expect(html).toContain("Contoh Apoteker, S.Farm., Apt.");
    const listed = staff.filter((person) => person.unit !== null).length;
    const unverified = staff.filter((person) => person.unit === null);
    expect(html.match(/scope="row"/g)).toHaveLength(officials.length + listed + unverified.length);
    expect(html).toContain("Data Kepegawaian Perlu Verifikasi");
    expect(unverified.map((person) => person.name)).toEqual(["Contoh Belum Terdata"]);
    expect(html).toContain("Penugasan komite");
    expect(html).toContain("Pendukung Direksi");
    expect(html).toContain("Kepala Bagian SDM dan Layanan Umum");
    expect(html).toContain("Garis pelaporan pada bagan menunggu konfirmasi Direktur.");
    expect(html).not.toMatch(/\d{4}-01-\d{6}/);
    expect(fullName({ name: "Contoh Nama", title: "", position: null, unit: null })).toBe("Contoh Nama");
    expect(fullName({ name: "Dedi", title: "dr.", position: null, unit: null })).toBe("dr. Dedi");
  });
});

describe("HRD position labels", () => {
  it("renders the updated label for every matching entry", () => {
    const people = staff.filter((person) => person.position === "Asisten Rumah Tangga");
    expect(people).toHaveLength(1);
    const html = renderToStaticMarkup(<HrdView directory={sample} query="Asisten Rumah Tangga" unit="Umum & SDM" />);
    expect(html.split(">Pranata Tata Graha</td>")).toHaveLength(people.length + 1);
    for (const person of people) expect(html).toContain(`>${fullName(person)}</th>`);
  });
});

describe("HRD staff filters", () => {
  it("matches display titles and applies a unit filter", () => {
    const matching = renderToStaticMarkup(<HrdView directory={sample} query="bidan pelaksana ruang bersalin" unit="Pelayanan" />);
    expect(matching).toContain("Contoh Bidan Satu");
    expect(matching).not.toContain("Contoh Apoteker");
    const empty = renderToStaticMarkup(<HrdView directory={sample} query="Contoh Bidan" unit="Farmasi" />);
    expect(empty).toContain("Tidak ada pegawai yang cocok");
    expect(empty).toContain("Contoh Belum Terdata");
  });
});

describe("HRD directory source", () => {
  const supabaseEnv = { MELINDAOS_SUPABASE_URL: "https://project.supabase.example/", MELINDAOS_SUPABASE_SECRET_KEY: "test-service-key" } as unknown as NodeJS.ProcessEnv;
  const emptyDir = () => mkdtempSync(join(tmpdir(), "hrd-"));

  it("reads the private bucket with the service key when Supabase is configured", async () => {
    const calls: string[] = [];
    const transport = (async (url: string, init?: RequestInit) => {
      calls.push(url);
      expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer test-service-key");
      return new Response(JSON.stringify(sampleJson), { status: 200 });
    }) as unknown as typeof fetch;
    const directory = await loadHrdDirectory({ env: supabaseEnv, transport, dataDir: emptyDir() });
    expect(calls).toEqual(["https://project.supabase.example/storage/v1/object/hrd/directory.json"]);
    expect(directory?.source).toBe("supabase");
    expect(directory?.staff).toHaveLength(staff.length);
  });

  it("never falls back to sample data when the bucket fails", async () => {
    const failing = (async () => new Response("nope", { status: 404 })) as unknown as typeof fetch;
    const throwing = (async () => { throw new Error("offline"); }) as unknown as typeof fetch;
    const broken = (async () => new Response(JSON.stringify({ officials: [{}], staff: [] }), { status: 200 })) as unknown as typeof fetch;
    for (const transport of [failing, throwing, broken]) {
      expect(await loadHrdDirectory({ env: supabaseEnv, transport, dataDir: join(process.cwd(), "data") })).toBeNull();
    }
  });

  it("uses the local file, then the fictional sample, when Supabase is not configured", async () => {
    const dir = emptyDir();
    mkdirSync(join(dir, "synthetic"));
    writeFileSync(join(dir, "synthetic", "hrd-directory.json"), JSON.stringify(sampleJson));
    expect((await loadHrdDirectory({ env: {} as NodeJS.ProcessEnv, dataDir: dir }))?.source).toBe("sample");
    mkdirSync(join(dir, "hrd"));
    writeFileSync(join(dir, "hrd", "directory.json"), JSON.stringify(sampleJson));
    expect((await loadHrdDirectory({ env: {} as NodeJS.ProcessEnv, dataDir: dir }))?.source).toBe("file");
    expect(await loadHrdDirectory({ env: {} as NodeJS.ProcessEnv, dataDir: emptyDir() })).toBeNull();
  });
});
