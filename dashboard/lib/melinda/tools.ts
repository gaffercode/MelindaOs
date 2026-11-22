import type { ReviewQueue } from "../director/director-api";
import type { DirectorAuthConfiguration } from "../director/director-auth";
import { wibDate } from "../director/director-data";
import { readExecutivePlan } from "../executive/executive-office-api";
import { logError } from "../log";
import { readMelindaBrief } from "./melinda-brief-store";
import { readMedifySnapshot } from "../medify/medify-snapshot-store";
import { knowledgePath } from "../navigation";
import { readOrderQueue } from "../pharmacy/order-obat-api";
import { sharedRetriever } from "../ask/http";
import { forRules, isFinal, isOverdue, reminderState } from "../tasks/rules";
import { board, listSchedule, vaultLedger } from "../tasks/store";
import { leadBriefRotation, type StructuralRoleId } from "../work-schedule/baseline-schedule";
import { buildEnrichedScheduleForRole } from "../work-schedule/sync-and-feedback";
import { resolveVaultTasks, type VaultTaskStatus } from "../work-schedule/task-vault";
import { readScheduleOverrides } from "../work-schedule/schedule-overrides";
import { openInstructions } from "../director/director-instructions-api";
import { DirectorStoreError } from "../director/director-store";
import { ActionInputError, ARAHAN_FINAL_STATUSES, knownOfficials, proposeAction, type ActionKind, type ActionProposal } from "./actions";
import type { ToolDefinition } from "./model";
import type { MelindaSource } from "./store";
import { melindaSystemMap } from "./system-map";

const MAX_RESULT = 20_000;
const MAX_TASKS = 30;
const noInput = { type: "object", properties: {}, required: [], additionalProperties: false };
const taskFilters = ["semua", "menunggu", "lewat_tenggat"] as const;
const structuralRoleIds: readonly StructuralRoleId[] = [
  "direktur",
  "wadir_ops",
  "wadir_keu_sdm",
  "kabag_pelayanan",
  "kabag_umum",
  "kabag_penunjang",
  "kepala_sdm",
  "kepala_keuangan",
];
const vaultStatusValues: readonly VaultTaskStatus[] = [
  "selesai",
  "berjalan",
  "pending_pihak_ketiga",
  "butuh_keputusan_direktur",
  "menunggu_verifikasi_novia",
];

const NAMES = { type: "array", items: { type: "string" } };

export const MELINDA_TOOLS: ToolDefinition[] = [
  { name: "baca_jadwal", description: "Jadwal dan rapat Direktur hari ini, urut jam, beserta kesiapannya.", input_schema: noInput, strict: true },
  { name: "baca_tugas", description: "Tugas Direktur yang masih berjalan: judul, PIC, status, tenggat, balasan terakhir staf.", input_schema: { type: "object", properties: { filter: { type: "string", enum: [...taskFilters] } }, required: ["filter"], additionalProperties: false }, strict: true },
  { name: "baca_berkas_menunggu", description: "Berkas order obat yang belum diputuskan dan pengajuan yang menunggu tinjauan.", input_schema: noInput, strict: true },
  { name: "baca_medify", description: "Angka agregat Medify: sensus bed, BOR, kunjungan rawat jalan dan IGD. Tanpa identitas pasien.", input_schema: noInput, strict: true },
  { name: "baca_morning_brief", description: "Isi Management Morning Brief terbaru.", input_schema: noInput, strict: true },
  { name: "cari_dokumen", description: "Cari di dokumen SPO dan kebijakan rumah sakit.", input_schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"], additionalProperties: false }, strict: true },
  {
    name: "baca_jadwal_struktural",
    description: "Baca jadwal kerja baseline lintas 8 jabatan struktural beserta bahan masalah Task Vault yang otomatis disuntikkan ke setiap rapat.",
    input_schema: {
      type: "object",
      properties: {
        date: { type: "string" },
        role: { type: "string", enum: [...structuralRoleIds] },
      },
      required: [],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: "baca_task_vault",
    description: "Baca seluruh daftar masalah Task Vault (Action Register & Master Log) lengkap dengan status selesai, berjalan, pending pihak ke-3, butuh keputusan Direktur, atau menunggu verifikasi dr. Novia.",
    input_schema: {
      type: "object",
      properties: {
        domain: { type: "string" },
        status: { type: "string", enum: [...vaultStatusValues] },
      },
      required: [],
      additionalProperties: false,
    },
    strict: true,
  },
  { name: "baca_peta_melindaos", description: "Peta MelindaOS: halaman, jenis tugas dan ID-nya, status, Rule #39, cara kerja usulan dan konfirmasi, serta daftar 8 jabatan dan pejabatnya. Baca ini bila ragu cara kerja sistem.", input_schema: noInput, strict: true },
  { name: "cari_pejabat", description: "Cari nama pejabat atau staf yang dikenal MelindaOS beserta jabatannya, untuk mencocokkan nama yang disebut Direktur sebelum mengganti PIC. Kosongkan nama untuk melihat semuanya.", input_schema: { type: "object", properties: { nama: { type: "string" } }, required: [], additionalProperties: false }, strict: true },
  { name: "baca_tindak_lanjut", description: "Arahan Direktur yang masih terbuka dalam 14 hari terakhir, dengan ID IOC, PIC, status, tenggat, dan tanda lewat tenggat.", input_schema: noInput, strict: true },
  {
    name: "usulkan_ganti_pic",
    description: "Siapkan usulan mengganti PIC sebuah tugas Task Vault (ID seperti ACT-2810-01) atau arahan (ID IOC-...). Status tugas tidak berubah. Perubahan baru tersimpan setelah Direktur menekan Konfirmasi.",
    input_schema: { type: "object", properties: { task_id: { type: "string" }, pic: NAMES, catatan: { type: "string" } }, required: ["task_id", "pic"], additionalProperties: false },
    strict: true,
  },
  {
    name: "usulkan_status_tugas",
    description: "Siapkan usulan mengubah status tugas. Task Vault: selesai, berjalan, pending_pihak_ketiga (isi pihak_ketiga), butuh_keputusan_direktur, menunggu_verifikasi_novia. Arahan IOC: selesai, ditunda, dibatalkan. Tersimpan setelah Konfirmasi.",
    input_schema: { type: "object", properties: { task_id: { type: "string" }, status: { type: "string", enum: [...new Set<string>([...vaultStatusValues, ...ARAHAN_FINAL_STATUSES])] }, pihak_ketiga: { type: "string" }, catatan: { type: "string" } }, required: ["task_id", "status"], additionalProperties: false },
    strict: true,
  },
  {
    name: "usulkan_tindak_lanjut",
    description: "Siapkan usulan follow-up: minta update kepada PIC dengan tenggat (YYYY-MM-DDTHH:MM, WIB). Isi task_id bila untuk tugas yang ada, atau judul bila hal baru. Tersimpan setelah Konfirmasi.",
    input_schema: { type: "object", properties: { task_id: { type: "string" }, judul: { type: "string" }, pic: NAMES, tenggat: { type: "string" }, catatan: { type: "string" } }, required: ["pic", "tenggat"], additionalProperties: false },
    strict: true,
  },
  {
    name: "usulkan_tugas_baru",
    description: "Siapkan usulan tugas baru dari Direktur untuk PIC tertentu, opsional dengan tenggat (YYYY-MM-DDTHH:MM, WIB). Tersimpan di Arahan setelah Konfirmasi.",
    input_schema: { type: "object", properties: { judul: { type: "string" }, pic: NAMES, tenggat: { type: "string" }, catatan: { type: "string" }, mendesak: { type: "boolean" } }, required: ["judul", "pic"], additionalProperties: false },
    strict: true,
  },
  {
    name: "usulkan_ubah_jadwal",
    description: "Siapkan usulan mengubah jadwal satu jabatan pada satu tanggal: tambah rapat (mulai, judul), pindah rapat (slot_id, mulai), atau batal rapat (slot_id). Ambil slot_id dari baca_jadwal_struktural. Bentrok jam ditampilkan di usulan. Tersimpan setelah Konfirmasi.",
    input_schema: {
      type: "object",
      properties: {
        jenis: { type: "string", enum: ["tambah", "pindah", "batal"] },
        jabatan: { type: "string", enum: [...structuralRoleIds] },
        tanggal: { type: "string" }, slot_id: { type: "string" }, mulai: { type: "string" }, selesai: { type: "string" },
        judul: { type: "string" }, tempat: { type: "string" }, catatan: { type: "string" },
      },
      required: ["jenis"],
      additionalProperties: false,
    },
    // Not strict: its eight optional fields would put the request at the API limit of 24 optional
    // strict parameters. parseScheduleChange checks every field on the server instead.
  },
  {
    name: "usulkan_sinkron",
    description: "Siapkan usulan menyinkronkan jadwal, Task Vault, Morning Brief (/), Arahan (/arahan), dan Warta (/berita) untuk satu tanggal. Berjalan setelah Konfirmasi.",
    input_schema: { type: "object", properties: { date: { type: "string" } }, required: [], additionalProperties: false },
    strict: true,
  },
];

export const TOOL_STATUS: Record<string, string> = {
  baca_jadwal: "Membaca jadwal hari ini",
  baca_tugas: "Membaca papan tugas",
  baca_berkas_menunggu: "Membaca berkas yang menunggu",
  baca_medify: "Membaca sensus dan kunjungan",
  baca_morning_brief: "Membaca morning brief",
  cari_dokumen: "Mencari di dokumen",
  baca_jadwal_struktural: "Memetakan jadwal 8 jabatan struktural",
  baca_task_vault: "Memeriksa Task Vault & hambatan pihak ke-3",
  baca_peta_melindaos: "Membaca peta MelindaOS",
  cari_pejabat: "Mencocokkan nama pejabat",
  baca_tindak_lanjut: "Membaca arahan yang masih terbuka",
  usulkan_ganti_pic: "Menyiapkan usulan ganti PIC",
  usulkan_status_tugas: "Menyiapkan usulan status tugas",
  usulkan_tindak_lanjut: "Menyiapkan usulan tindak lanjut",
  usulkan_tugas_baru: "Menyiapkan usulan tugas baru",
  usulkan_ubah_jadwal: "Menyiapkan usulan perubahan jadwal",
  usulkan_sinkron: "Menyiapkan usulan sinkronisasi",
};

const FAILURE_LABEL: Record<string, string> = {
  baca_jadwal: "jadwal",
  baca_tugas: "tugas",
  baca_berkas_menunggu: "berkas",
  baca_medify: "Medify",
  baca_morning_brief: "morning brief",
  cari_dokumen: "dokumen",
  baca_jadwal_struktural: "jadwal struktural",
  baca_task_vault: "Task Vault",
  baca_peta_melindaos: "peta MelindaOS",
  cari_pejabat: "daftar pejabat",
  baca_tindak_lanjut: "arahan terbuka",
  usulkan_ganti_pic: "usulan ganti PIC",
  usulkan_status_tugas: "usulan status tugas",
  usulkan_tindak_lanjut: "usulan tindak lanjut",
  usulkan_tugas_baru: "usulan tugas baru",
  usulkan_ubah_jadwal: "usulan perubahan jadwal",
  usulkan_sinkron: "usulan sinkronisasi",
};

/** Tool output is data: nothing inside it can open or close the wrapper the system prompt tells the model to distrust. */
export function wrapToolData(name: string, payload: string): string {
  return `<data_alat sumber="${name}">\n${payload.replace(/<(\/?)data_alat/gi, "&lt;$1data_alat")}\n</data_alat>`;
}

export type Context = { config: DirectorAuthConfiguration; now: Date; owner: string; conversationId: string | null };
type Output = { payload: unknown; sources?: MelindaSource[]; proposal?: ActionProposal };
class BadInput extends Error {}

async function readSchedule({ config, now }: Context): Promise<Output> {
  const date = wibDate(now);
  const [dash, office] = await Promise.allSettled([listSchedule(config, { date }), readExecutivePlan(config, date)]);
  if (dash.status === "rejected" && office.status === "rejected") throw dash.reason;
  return { payload: {
    jadwal: dash.status === "fulfilled" ? dash.value.items.map((item) => ({ mulai: item.start, selesai: item.end, judul: item.title, tempat: item.place, pic: item.pic })) : null,
    rapat: office.status === "fulfilled" ? office.value.meetings.map((item) => ({ mulai: item.startAt, selesai: item.endAt, judul: item.title, kesiapan: item.readiness, bentrok: item.conflict })) : null,
    ...(dash.status === "rejected" || office.status === "rejected" ? { catatan: "Nilai null berarti sumber itu gagal dibaca, bukan kosong." } : {}),
  } };
}

async function readTasks({ config, now }: Context, input: Record<string, unknown>): Promise<Output> {
  const filter = input.filter;
  if (typeof filter !== "string" || !(taskFilters as readonly string[]).includes(filter)) throw new BadInput();
  const nowWib = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Jakarta", dateStyle: "short", timeStyle: "short" }).format(now).replace(" ", "T");
  const { instructions } = await board(config, { now: now.toISOString() });
  const rows = instructions.filter((row) => {
    const rules = forRules(row);
    if (isFinal(rules)) return false;
    if (filter === "lewat_tenggat") return isOverdue(rules, nowWib);
    return filter === "semua" || reminderState(rules, now) !== "none" || row.status === "terkendala";
  });
  return { payload: {
    jumlah: rows.length,
    tugas: rows.slice(0, MAX_TASKS).map((row) => ({ id: row.id, judul: row.itemTitle, pic: row.pic, status: row.status, tenggat: row.deadline, catatan: row.note, balasan_terakhir: row.latestReply ? { dari: row.latestReply.fromName, ringkasan: row.latestReply.summary ?? row.latestReply.originalText.slice(0, 200), waktu: row.latestReply.receivedAt } : null })),
  } };
}

async function readWaiting({ config, now }: Context): Promise<Output> {
  const [orders, reviews] = await Promise.all([readOrderQueue(config), config.store.call<ReviewQueue>("review_list", { date: wibDate(now), offset: 0 })]);
  return { payload: {
    order_obat_belum_diputuskan: orders.orders.filter((order) => !orders.decisions[order.key]).map((order) => ({ berkas: order.fileName, diunggah: order.uploadedAt })),
    pengajuan_menunggu_tinjauan: reviews.pending.map((item) => ({ tanggal: item.report_date, pengirim: item.producer, diterima: item.received_at })),
  } };
}

/** Field by field on purpose: only aggregates leave, so a new field in the snapshot cannot reach the model by accident. */
async function readMedify({ now }: Context): Promise<Output> {
  const result = await readMedifySnapshot(wibDate(now), now);
  if (!result.snapshot) return { payload: { pesan: result.message } };
  const { bed, outpatient, igd, inpatient, patients } = result.snapshot;
  return { payload: {
    status: result.status,
    bed: bed?.wards.map((ward) => ({ ruang: ward.ward, kelas: ward.kelas, terisi: ward.occupied, kapasitas: ward.capacity })) ?? null,
    rawat_jalan_hari_ini: outpatient?.visitsToday ?? null,
    igd_hari_ini: igd?.visitsToday ?? null,
    diagnosis_igd_terbanyak: igd?.topDiagnoses.slice(0, 5) ?? null,
    rawat_inap_hari_terakhir: inpatient?.daily.at(-1) ?? null,
    rawat_inap_bulan_ini: inpatient?.monthly.at(-1) ?? null,
    pasien_terdaftar: patients?.total ?? null,
  } };
}

async function readBrief({ now }: Context): Promise<Output> {
  const result = await readMelindaBrief(wibDate(now));
  return { payload: result.brief ? { status: result.status, tanggal_sumber: result.sourceDate, brief: result.brief } : { pesan: result.message } };
}

async function searchDocuments(_: Context, input: Record<string, unknown>): Promise<Output> {
  if (typeof input.query !== "string" || !input.query.trim() || input.query.length > 300) throw new BadInput();
  const hits = (await sharedRetriever()).search(input.query, 8);
  const sources = new Map<string, MelindaSource>();
  for (const { chunk } of hits) {
    const href = knowledgePath(chunk.docId || chunk.title.slice(0, 120));
    if (!sources.has(href)) sources.set(href, { label: `${chunk.title} › ${chunk.headingPath.join(" › ")}`, href });
  }
  return { payload: hits.length ? hits.map(({ chunk }) => ({ judul: chunk.title, bagian: chunk.headingPath.join(" › "), isi: chunk.text })) : { pesan: "Tidak ditemukan di dokumen MelindaOS." }, sources: [...sources.values()] };
}

async function readStructuralSchedule({ config, now }: Context, input: Record<string, unknown>): Promise<Output> {
  const date = typeof input.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(input.date) ? input.date : wibDate(now);
  const role = typeof input.role === "string" && structuralRoleIds.includes(input.role as StructuralRoleId)
    ? (input.role as StructuralRoleId)
    : "direktur";
  const instructions = await vaultLedger(config, { now: now.toISOString() }).catch(() => []);
  const rotation = leadBriefRotation(date);
  const overrides = await readScheduleOverrides(config, date, role);
  const { slots } = buildEnrichedScheduleForRole(date, role, instructions, overrides);
  return {
    payload: {
      tanggal: date,
      jabatan: role,
      pekan_lead_brief: rotation.weekIndex,
      pemimpin_lead_brief: rotation.leaderName,
      slot_jadwal: slots.map((s) => ({
        id: s.id,
        jam: s.timeRange,
        forum: s.forumId,
        judul: s.title,
        peserta: s.participants,
        bahan_injeksi: s.injectedTasks.map((t) => ({ id: t.id, judul: t.title, status: t.status, pihak_ketiga: t.thirdPartyName ?? null, pic: t.pic })),
      })),
    },
  };
}

async function readTaskVault({ config, now }: Context, input: Record<string, unknown>): Promise<Output> {
  const instructions = await vaultLedger(config, { now: now.toISOString() }).catch(() => []);
  let tasks = resolveVaultTasks(instructions);
  if (typeof input.domain === "string" && input.domain.trim()) {
    const q = input.domain.trim().toLowerCase();
    tasks = tasks.filter((t) => t.domain.toLowerCase().includes(q));
  }
  if (typeof input.status === "string" && vaultStatusValues.includes(input.status as VaultTaskStatus)) {
    tasks = tasks.filter((t) => t.status === input.status);
  }
  return {
    payload: {
      jumlah: tasks.length,
      tugas: tasks.slice(0, MAX_TASKS).map((t) => ({
        id: t.id,
        bidang: t.domain,
        judul: t.title,
        status: t.status,
        prioritas: t.priority,
        pic: t.pic,
        pihak_ketiga: t.thirdPartyName ?? null,
        hambatan: t.thirdPartyBlocker ?? null,
        tenggat: t.deadlineLabel,
        forum_rapat: t.targetForums,
      })),
    },
  };
}

async function findOfficials({ config }: Context, input: Record<string, unknown>): Promise<Output> {
  const query = typeof input.nama === "string" ? input.nama.trim().toLowerCase() : "";
  const all = await knownOfficials(config);
  const hits = query ? all.filter((item) => item.name.toLowerCase().includes(query) || (item.role ?? "").toLowerCase().includes(query)) : all;
  return { payload: { jumlah: hits.length, pejabat: hits.map((item) => ({ nama: item.name, jabatan: item.role })), ...(query && hits.length === 0 ? { pesan: "Tidak ada yang cocok; tanyakan nama lengkapnya kepada Direktur." } : {}) } };
}

async function readFollowUps({ config, now }: Context): Promise<Output> {
  const nowWib = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Jakarta", dateStyle: "short", timeStyle: "short" }).format(now).replace(" ", "T");
  const { instructions } = await openInstructions(config, wibDate(now), 14);
  return { payload: {
    jumlah: instructions.length,
    arahan: instructions.slice(0, MAX_TASKS).map((row) => ({ id: row.id, judul: row.itemTitle, pic: row.pic, status: row.status, tenggat: row.deadline, lewat_tenggat: row.deadline !== null && row.deadline < nowWib, tanggal: row.reportDate })),
  } };
}

const proposer = (kind: ActionKind) => async ({ config, now, owner, conversationId }: Context, input: Record<string, unknown>): Promise<Output> => {
  try {
    const proposal = await proposeAction(config, { owner, conversationId, now, kind, input });
    return { payload: { status: "menunggu_konfirmasi", ringkasan: proposal.summary, pesan: "Usulan tampil di bawah jawaban. Belum ada yang berubah sampai Direktur menekan Konfirmasi." }, proposal };
  } catch (error) {
    if (error instanceof ActionInputError) return { payload: { status: "ditolak", alasan: error.message } };
    if (error instanceof DirectorStoreError && error.code === "missing_function") return { payload: { status: "belum_aktif", alasan: "Fitur usulan perubahan belum aktif: migrasi database 202611220002 dan 202611220003 belum diterapkan." } };
    throw error;
  }
};

const READERS: Record<string, (ctx: Context, input: Record<string, unknown>) => Promise<Output>> = {
  baca_jadwal: readSchedule,
  baca_tugas: readTasks,
  baca_berkas_menunggu: readWaiting,
  baca_medify: readMedify,
  baca_morning_brief: readBrief,
  cari_dokumen: searchDocuments,
  baca_jadwal_struktural: readStructuralSchedule,
  baca_task_vault: readTaskVault,
  baca_peta_melindaos: async () => ({ payload: melindaSystemMap() }),
  cari_pejabat: findOfficials,
  baca_tindak_lanjut: readFollowUps,
  usulkan_ganti_pic: proposer("ganti_pic"),
  usulkan_status_tugas: proposer("status_tugas"),
  usulkan_tindak_lanjut: proposer("tindak_lanjut"),
  usulkan_tugas_baru: proposer("tugas_baru"),
  usulkan_ubah_jadwal: proposer("ubah_jadwal"),
  usulkan_sinkron: proposer("sinkron"),
};

/** Runs one tool: a read, or a proposal that writes nothing until the Director confirms. Never throws: a failure becomes an error result the model can report. */
export async function runTool(name: string, input: unknown, ctx: Context): Promise<{ text: string; sources: MelindaSource[]; isError: boolean; proposal?: ActionProposal }> {
  const reader = Object.hasOwn(READERS, name) ? READERS[name] : undefined;
  if (!reader || typeof input !== "object" || input === null) return { text: "Alat ini tidak tersedia.", sources: [], isError: true };
  try {
    const { payload, sources = [], proposal } = await reader(ctx, input as Record<string, unknown>);
    const json = JSON.stringify(payload);
    return { text: wrapToolData(name, json.length > MAX_RESULT ? `${json.slice(0, MAX_RESULT)} (terpotong)` : json), sources, isError: false, ...(proposal ? { proposal } : {}) };
  } catch (error) {
    if (error instanceof BadInput) return { text: "Masukan alat tidak valid.", sources: [], isError: true };
    logError(`melinda_tool_${name}`, error);
    return { text: `Data ${FAILURE_LABEL[name]} tidak dapat dibaca.`, sources: [], isError: true };
  }
}
