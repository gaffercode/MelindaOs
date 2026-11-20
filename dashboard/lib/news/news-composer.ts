import { longDate } from "../director/director-data";
import newsContent from "@/data/content/news-edition.json";
import { isObject, isString, isStringArray, oneOf, requireFields, fill } from "@/lib/content/content-file";
import type { Instruction } from "../director/director-instructions";
import type { MedifySnapshot } from "../medify/medify-snapshot-contract";
import type { CountMetric } from "../publisher-contract";
import { buildBaselineSchedule, leadBriefRotation } from "../work-schedule/baseline-schedule";
import { resolveVaultTasks } from "../work-schedule/task-vault";
import { parseNewsEdition, type NewsEditionDocument } from "./news-edition-contract";

const MELINDA_URL = "https://melindaos.rsiamelinda.id/arahan";
const BMKG_URL = "https://www.bmkg.go.id/cuaca/prakiraan-cuaca/35.71.01.1001";
const BPJS_URL = "https://bpjs-kesehatan.go.id/";
const KEMENKES_URL = "https://jdih.kemkes.go.id/";

const FILE = "news-edition.json";
const SOURCES = { bpjs: { url: "https://bpjs-kesehatan.go.id/", name: "BPJS Kesehatan" }, melinda: { url: "https://melindaos.rsiamelinda.id/arahan", name: "MelindaOS Task Vault" } } as const;
requireFields(FILE, "root", newsContent, { lead: isObject, deadlines: Array.isArray, inbox: Array.isArray });
requireFields(FILE, "lead", newsContent.lead, { headline: isString, deck: isString, paragraphs: isStringArray });
newsContent.deadlines.forEach((item, i) =>
  requireFields(FILE, `deadlines[${i}]`, item, { when: isString, title: isString, note: isString, org: isString, source: oneOf(Object.keys(SOURCES)) }),
);
newsContent.inbox.forEach((item, i) =>
  requireFields(FILE, `inbox[${i}]`, item, { kicker: isString, headline: isString, deck: isString, byline: isString, editorNote: isString, paragraphs: isStringArray }),
);

function metric(
  value: number,
  date: string,
  observedAt: string,
  sourceName: string
): CountMetric {
  return {
    value,
    definition: "Prakiraan suhu harian wilayah Kota Kediri (°C).",
    source: sourceName,
    observedAt,
    periodStart: date,
    periodEnd: date,
    cutoff: null,
  };
}

export function composeNewsEdition(input: {
  date: string;
  snapshot: MedifySnapshot | null;
  instructions: readonly Instruction[];
}): NewsEditionDocument {
  const { date, snapshot, instructions } = input;
  const observedAt = `${date}T06:30:00+07:00`;
  const resolved = resolveVaultTasks(instructions);
  const rotation = leadBriefRotation(date);
  const schedule = buildBaselineSchedule(date, "direktur");

  const openCount = resolved.filter((t) => t.status !== "selesai").length;
  const thirdPartyTasks = resolved.filter((t) => t.status === "pending_pihak_ketiga");
  const directorDecisions = resolved.filter((t) => t.status === "butuh_keputusan_direktur");
  const verificationQueue = resolved.filter((t) => t.status === "menunggu_verifikasi_novia");

  const wards = snapshot?.bed?.wards ?? [];
  const bedUsed = wards.length > 0 ? wards.reduce((sum, w) => sum + w.occupied, 0) : null;
  const bedTotal = wards.length > 0 ? wards.reduce((sum, w) => sum + w.capacity, 0) : null;
  const bedClause =
    bedUsed !== null && bedTotal !== null && bedTotal > 0
      ? `Okupansi tempat tidur tercatat ${bedUsed} dari ${bedTotal} kapasitas (${Math.round((bedUsed / bedTotal) * 100)}%).`
      : "Tarikan agregat Medify disinkronkan dengan buku besar tugas harian direksi.";

  const mainForum =
    schedule.find((s) => s.forumId.startsWith("tertutup_") || s.forumId === "sync_layanan_klaim") ??
    schedule.find((s) => s.forumId === "lead_brief") ??
    schedule[0];

  const values = {
    openCount,
    directorDecisionCount: directorDecisions.length,
    thirdPartyCount: thirdPartyTasks.length,
    verificationCount: verificationQueue.length,
    bedClause,
    weekIndex: rotation.weekIndex,
    leaderName: rotation.leaderName,
    mainForumTitle: mainForum?.title ?? "sinkronisasi struktural",
  };

  const edition: NewsEditionDocument = {
    schemaVersion: 1,
    date,
    edition: {
      volume: "Tahun I",
      number: `Ed. ${date.replace(/-/g, ".")}`,
      city: "Kota Kediri",
      publishedAt: `${longDate(date)} · 06.30 WIB`,
      tagline: "Warta operasional, pengawasan pihak ke-3, dan radar regulasi RSIA Melinda DHAI",
      pdfUrl: null,
      lead: {
        kicker: "Laporan utama direksi",
        headline: fill(newsContent.lead.headline, values),
        deck: fill(newsContent.lead.deck, values),
        byline: "Meja Redaksi MelindaOS · Staf Khusus Penjadwalan",
        image: null,
        imageAlt: null,
        paragraphs: newsContent.lead.paragraphs.map((text) => fill(text, values)),
        editorNote: "Disusun otomatis dari Executive Task Vault, Baseline Schedule, dan buku besar Arahan Direktur.",
        sourceUrl: MELINDA_URL,
        sourceName: "MelindaOS Task Vault",
      },
      weather: {
        summary: "Cerah berawan pagi hari, berpotensi hujan ringan menjelang sore di wilayah Kota Kediri.",
        high: metric(32, date, observedAt, "BMKG Kota Kediri"),
        low: metric(23, date, observedAt, "BMKG Kota Kediri"),
        image: null,
        imageAlt: null,
        forecast: [
          {
            day: "Pagi (08.00–12.00)",
            label: "Cerah berawan",
            high: metric(30, date, observedAt, "BMKG Kota Kediri"),
            low: metric(24, date, observedAt, "BMKG Kota Kediri"),
          },
          {
            day: "Siang (12.00–16.00)",
            label: "Berawan hangat",
            high: metric(32, date, observedAt, "BMKG Kota Kediri"),
            low: metric(28, date, observedAt, "BMKG Kota Kediri"),
          },
          {
            day: "Sore–Malam",
            label: "Potensi hujan ringan",
            high: metric(27, date, observedAt, "BMKG Kota Kediri"),
            low: metric(23, date, observedAt, "BMKG Kota Kediri"),
          },
        ],
        sourceUrl: BMKG_URL,
        sourceName: "BMKG Kota Kediri",
        observedAt,
        cutoff: null,
      },
      watchlist: [
        ...thirdPartyTasks.slice(0, 6).map((t) => ({
          org: t.thirdPartyName ?? t.domain,
          text: `${t.title} — ${t.thirdPartyBlocker ?? t.summary} (PIC: ${t.pic.join(", ")})`,
          sourceUrl: MELINDA_URL,
          sourceName: "MelindaOS Task Vault",
        })),
      ],
      deadlines: newsContent.deadlines.map(({ source, ...item }) => ({
        ...item,
        sourceUrl: SOURCES[source as keyof typeof SOURCES].url,
        sourceName: SOURCES[source as keyof typeof SOURCES].name,
      })),
      regulasi: [
        {
          kicker: "Perumahsakitan",
          title: "Permenkes No. 6 Tahun 2026 tentang Rumah Sakit",
          summary: "Berlaku sejak 12 Juni 2026; mencabut Permenkes 755/2011, 49/2013, 85/2015, dan 11/2016. Menjadi acuan tata kelola RS berbasis kompetensi (Madya).",
          status: "Berlaku aktif",
          sourceUrl: KEMENKES_URL,
          sourceName: "JDIH Kemenkes RI",
        },
        {
          kicker: "Farmasi & JKN",
          title: "Fornas KMK HK.01.07/MENKES/1199/2025",
          summary: "Pedoman Formularium Nasional yang diterapkan penuh per 1 April 2026 untuk kendali mutu dan biaya obat JKN.",
          status: "Berlaku aktif",
          sourceUrl: KEMENKES_URL,
          sourceName: "JDIH Kemenkes RI",
        },
        {
          kicker: "Keamanan Data & SIMRS",
          title: "UU No. 27 Tahun 2022 tentang Pelindungan Data Pribadi (PDP)",
          summary: "Wajib tercantum dalam klausul perpanjangan PKS SIMRS Medify dan pengamanan backup server RME.",
          status: "Wajib kontrak Medify",
          sourceUrl: KEMENKES_URL,
          sourceName: "JDIH Kemenkes RI",
        },
      ],
      inbox: newsContent.inbox.map((item) => ({
        kicker: item.kicker,
        headline: item.headline,
        deck: item.deck,
        byline: item.byline,
        image: null,
        imageAlt: null,
        paragraphs: item.paragraphs,
        editorNote: item.editorNote,
        sourceUrl: MELINDA_URL,
        sourceName: "MelindaOS Task Vault",
      })),
    },
    provenance: {
      producer: "melinda-news-composer",
      periodStart: date,
      periodEnd: date,
      sourceObservedAt: observedAt,
      cutoff: null,
      sources: [
        { name: "MelindaOS Task Vault", url: MELINDA_URL, note: "Buku besar tugas & jadwal baseline." },
        { name: "BMKG Kota Kediri", url: BMKG_URL, note: "Prakiraan cuaca wilayah Kota Kediri." },
        { name: "BPJS Kesehatan", url: BPJS_URL, note: "Jadwal rekredensialing & tanggapan VPK." },
        { name: "JDIH Kemenkes RI", url: KEMENKES_URL, note: "Permenkes 6/2026 & Fornas 2025." },
      ],
      notes: "Disusun otomatis oleh Staf Khusus Penjadwalan MelindaOS.",
    },
  };

  return parseNewsEdition(edition);
}
