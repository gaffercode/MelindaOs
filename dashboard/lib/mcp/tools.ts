import { sharedRetriever } from "../ask/http";
import { composeFullExecutiveBrief } from "../composer/compose";
import { detectFacts } from "../composer/facts";
import { submitDailyDocument, submitDailyDocumentFile } from "../daily/daily-documents";
import { auditClinicalRead, listClinicalEntries } from "../clinical/clinical-store";
import type { ClinicalKind, StoredClinicalEntry } from "../clinical/clinical-types";
import { canonicalHash } from "../director/director-store";
import { validReportDate, wibDate } from "../director/director-data";
import { parseInstructionInput, type Instruction } from "../director/director-instructions";
import { readExecutivePlan } from "../executive/executive-office-api";
import { logError } from "../log";
import { readMedifySnapshot } from "../medify/medify-snapshot-store";
import { parseMelindaBrief } from "../melinda/melinda-brief-contract";
import { readMelindaBrief } from "../melinda/melinda-brief-store";
import { composeNewsEdition } from "../news/news-composer";
import { parseNewsEdition } from "../news/news-edition-contract";
import { readNewsEdition } from "../news/news-edition-store";
import { findPatientIdentifiers, identifierLabels } from "../phi-guard";
import { getDashboardData, loadKnowledgeChunks, loadKnowledgeDocuments, searchDocuments } from "../repository";
import { parseScheduleSubmission } from "../tasks/contract";
import { forRules, isFinal, isOverdue, reminderState } from "../tasks/rules";
import { board, listSchedule, replaceSchedule, vaultLedger, type BoardInstruction } from "../tasks/store";
import { leadBriefRotation, type StructuralRoleId } from "../work-schedule/baseline-schedule";
import { buildEnrichedScheduleForRole, buildFallbackBoardSchedule, buildFallbackOfficePlan } from "../work-schedule/fallbacks";
import { readScheduleOverrides } from "../work-schedule/schedule-overrides";
import { submitVaultTaskFeedback, syncTodayAllPages } from "../work-schedule/sync-and-feedback";
import { applyRule39, formatFeedbackNote, resolveVaultTasks, stripExecutiveTag, VAULT_TASKS, type VaultTaskStatus } from "../work-schedule/task-vault";
import type { McpAuthContext } from "./auth";

export const MCP_LOGO_URL = "https://melindaos.app/brand/melindaos-logo.png";
export const MCP_ICONS = [
  { src: "https://melindaos.app/brand/melindaos-logo.png", mimeType: "image/png", sizes: ["512x512"] },
  { src: "https://melindaos.app/branding/rsia-melinda-logo-official.png", mimeType: "image/png", sizes: ["512x512"] },
] as const;

export type McpToolDefinition = {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
    additionalProperties?: boolean;
  };
};

const STRUCTURAL_ROLE_IDS: readonly StructuralRoleId[] = [
  "direktur",
  "wadir_ops",
  "wadir_keu_sdm",
  "kabag_pelayanan",
  "kabag_umum",
  "kabag_penunjang",
  "kepala_sdm",
  "kepala_keuangan",
];

const VAULT_STATUS_VALUES: readonly VaultTaskStatus[] = [
  "selesai",
  "berjalan",
  "pending_pihak_ketiga",
  "butuh_keputusan_direktur",
  "menunggu_verifikasi_novia",
];

const TASK_FILTERS = ["semua", "menunggu", "lewat_tenggat"] as const;

export const MCP_TOOLS: McpToolDefinition[] = [
  {
    name: "agent_overview",
    description: "Ringkasan MelindaOS All-Access MCP: daftar 10 agent resmi, status validasi knowledge, dan mode akses aktif.",
    inputSchema: { type: "object", properties: {}, required: [], additionalProperties: false },
  },
  {
    name: "daftar_dokumen",
    description: "Daftar metadata dokumen knowledge MelindaOS (filter category A/B/C, domain, department, q, limit, offset).",
    inputSchema: {
      type: "object",
      properties: {
        category: { type: "string", enum: ["A", "B", "C"] },
        domain: { type: "string" },
        department: { type: "string" },
        q: { type: "string" },
        limit: { type: "number" },
        offset: { type: "number" },
      },
      required: [],
      additionalProperties: false,
    },
  },
  {
    name: "cari_dokumen",
    description: "Cari dokumen dan potongan paragraf (chunk) di seluruh basis pengetahuan MelindaOS.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        limit: { type: "number" },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "baca_dokumen",
    description: "Baca isi lengkap dan metadata satu dokumen knowledge berdasarkan path atau doc_id.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
      },
      required: ["path"],
      additionalProperties: false,
    },
  },
  {
    name: "baca_jadwal",
    description: "Baca jadwal Direktur dan kesiapan rapat Executive Office untuk satu tanggal (YYYY-MM-DD).",
    inputSchema: {
      type: "object",
      properties: { date: { type: "string" } },
      required: [],
      additionalProperties: false,
    },
  },
  {
    name: "simpan_jadwal",
    description: "Perbarui/ganti daftar jadwal Direktur untuk satu tanggal (1–40 butir).",
    inputSchema: {
      type: "object",
      properties: {
        date: { type: "string" },
        items: { type: "array" },
      },
      required: ["date", "items"],
      additionalProperties: false,
    },
  },
  {
    name: "baca_jadwal_struktural",
    description: "Baca jadwal kerja baseline lintas 8 jabatan struktural lengkap dengan injeksi bahan masalah Task Vault.",
    inputSchema: {
      type: "object",
      properties: {
        date: { type: "string" },
        role: { type: "string", enum: [...STRUCTURAL_ROLE_IDS] },
      },
      required: [],
      additionalProperties: false,
    },
  },
  {
    name: "baca_task_vault",
    description: "Baca daftar lengkap Task Vault (Action Register & Master Log) dengan filter domain, status, atau prioritas.",
    inputSchema: {
      type: "object",
      properties: {
        domain: { type: "string" },
        status: { type: "string", enum: [...VAULT_STATUS_VALUES] },
        priority: { type: "string", enum: ["P0", "P1", "P2"] },
      },
      required: [],
      additionalProperties: false,
    },
  },
  {
    name: "ubah_status_tugas",
    description: "Perbarui status tugas Task Vault ke buku besar Arahan Direktur (Rule #39 berlaku: selesai dari agent menjadi menunggu_verifikasi_novia). bypass_rule39 hanya berlaku pada sesi Direktur yang login; dari token agent diabaikan.",
    inputSchema: {
      type: "object",
      properties: {
        task_id: { type: "string" },
        status: { type: "string", enum: [...VAULT_STATUS_VALUES] },
        pihak_ketiga: { type: "string" },
        catatan: { type: "string" },
        bypass_rule39: { type: "boolean" },
      },
      required: ["task_id", "status"],
      additionalProperties: false,
    },
  },
  {
    name: "baca_tugas",
    description: "Baca daftar tugas/arahan Direktur di papan tugas (filter: semua, menunggu, lewat_tenggat).",
    inputSchema: {
      type: "object",
      properties: {
        filter: { type: "string", enum: [...TASK_FILTERS] },
      },
      required: [],
      additionalProperties: false,
    },
  },
  {
    name: "buat_arahan",
    description: "Catat arahan Direktur baru ke buku besar (melinda_director_instructions).",
    inputSchema: {
      type: "object",
      properties: {
        reportDate: { type: "string" },
        section: { type: "string", enum: ["priorities", "followUps", "decisions", "umum"] },
        itemId: { type: "string" },
        itemTitle: { type: "string" },
        urgent: { type: "boolean" },
        action: { type: "string", enum: ["approve", "request_update", "assign", "escalate", "defer", "done"] },
        deadline: { type: "string" },
        pic: { type: "array", items: { type: "string" } },
        note: { type: "string" },
      },
      required: ["itemTitle", "action"],
      additionalProperties: false,
    },
  },
  {
    name: "baca_morning_brief",
    description: "Baca Management Morning Brief terbaru untuk tanggal tertentu (YYYY-MM-DD).",
    inputSchema: {
      type: "object",
      properties: { date: { type: "string" } },
      required: [],
      additionalProperties: false,
    },
  },
  {
    name: "terbitkan_morning_brief",
    description: "Susun otomatis dan/atau terbitkan Management Morning Brief ke penyimpanan.",
    inputSchema: {
      type: "object",
      properties: {
        date: { type: "string" },
        brief: { type: "object" },
      },
      required: [],
      additionalProperties: false,
    },
  },
  {
    name: "baca_warta",
    description: "Baca edisi Warta & Regulasi (/berita) untuk tanggal tertentu (YYYY-MM-DD).",
    inputSchema: {
      type: "object",
      properties: { date: { type: "string" } },
      required: [],
      additionalProperties: false,
    },
  },
  {
    name: "terbitkan_warta",
    description: "Susun otomatis dan/atau terbitkan edisi Warta & Regulasi (/berita) ke penyimpanan.",
    inputSchema: {
      type: "object",
      properties: {
        date: { type: "string" },
        edition: { type: "object" },
      },
      required: [],
      additionalProperties: false,
    },
  },
  {
    name: "baca_medify",
    description: "Baca angka agregat Medify SIMRS: sensus bed, BOR, kunjungan rawat jalan dan IGD (tanpa identitas pasien).",
    inputSchema: {
      type: "object",
      properties: { date: { type: "string" } },
      required: [],
      additionalProperties: false,
    },
  },
  {
    name: "baca_handover",
    description: "Baca serah terima klinis (SBAR) yang diisi Direktur atau dokter. Memuat identitas pasien; pembacaan dicatat di jejak audit. Tanpa tanggal: 7 hari terakhir; rentang maksimal 31 hari.",
    inputSchema: {
      type: "object",
      properties: { date: { type: "string" }, from: { type: "string" }, to: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 100 } },
      required: [],
      additionalProperties: false,
    },
  },
  {
    name: "baca_roster",
    description: "Baca roster jaga per tanggal dan shift yang diisi Direktur atau dokter. Pembacaan dicatat di jejak audit. Tanpa tanggal: 7 hari terakhir.",
    inputSchema: {
      type: "object",
      properties: { date: { type: "string" }, from: { type: "string" }, to: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 100 } },
      required: [],
      additionalProperties: false,
    },
  },
  {
    name: "baca_insiden",
    description: "Baca laporan insiden (KTD, KNC, KPC, sentinel) yang diisi Direktur atau dokter. Pembacaan dicatat di jejak audit. Tanpa tanggal: 7 hari terakhir.",
    inputSchema: {
      type: "object",
      properties: { date: { type: "string" }, from: { type: "string" }, to: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 100 } },
      required: [],
      additionalProperties: false,
    },
  },
  {
    name: "sinkronkan_halaman",
    description: "Sinkronkan jadwal baseline, Task Vault, Morning Brief (/), Arahan (/arahan), dan Warta (/berita) untuk satu tanggal.",
    inputSchema: {
      type: "object",
      properties: { date: { type: "string" } },
      required: [],
      additionalProperties: false,
    },
  },
];

export class McpToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "McpToolError";
  }
}

function resolveDate(raw: unknown, now: Date): string {
  if (typeof raw === "string" && raw.trim()) {
    const d = raw.trim();
    if (!validReportDate(d)) throw new McpToolError("Tanggal tidak valid. Gunakan format YYYY-MM-DD.");
    return d;
  }
  return wibDate(now);
}

function assertNoPhi(payload: unknown): void {
  const found = new Set<ReturnType<typeof findPatientIdentifiers>[number]>();
  const visit = (value: unknown) => {
    if (typeof value === "string") {
      for (const id of findPatientIdentifiers(value)) found.add(id);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (value && typeof value === "object") {
      for (const child of Object.values(value)) visit(child);
    }
  };
  visit(payload);
  if (found.size > 0) {
    throw new McpToolError(
      `Payload memuat indikator data pasien (${[...found].map((id) => identifierLabels[id]).join(", ")}). Hapus lalu kirim ulang.`
    );
  }
}

/** Indonesian-key view of one clinical entry, the way the other MCP read tools answer. */
function clinicalView(entry: StoredClinicalEntry): Record<string, unknown> {
  const head = { id: entry.id, tanggal: entry.date, shift: entry.shift, unit: entry.unit, dicatat_oleh: entry.createdBy, direvisi: entry.revision };
  if (entry.kind === "handover") {
    const p = entry.payload;
    return { ...head, pasien: p.patient, no_rm: p.rm, ruang: p.room, situasi: p.situation, latar_belakang: p.background, penilaian: p.assessment, rekomendasi: p.recommendation, tindakan_belum_selesai: p.pending, diserahkan_oleh: p.from, diterima_oleh: p.to };
  }
  if (entry.kind === "roster") return { ...head, petugas: entry.payload.people.map((person) => ({ nama: person.name, peran: person.role })), catatan: entry.payload.notes };
  const p = entry.payload;
  return { ...head, jam: p.time, lokasi: p.place, jenis: p.type, grading: p.grade, kronologi: p.chronology, tindak_lanjut: p.followUp, status_penanganan: p.progress, pelapor: p.reporter };
}

/**
 * Read clinical entries for an MCP caller. Every caller shares one identity, so each read is written to the audit table
 * first; if that write fails the data is not returned (fail closed).
 */
async function readClinical(kind: ClinicalKind, args: Record<string, unknown>, ctx: McpAuthContext, now: Date): Promise<unknown> {
  if (!ctx.config) return { status: "tidak_tersedia", pesan: "Data klinis hanya tersedia saat dashboard memakai penyimpanan Supabase." };
  let from: string;
  let to: string;
  if (typeof args.date === "string" && args.date.trim()) {
    from = to = resolveDate(args.date, now);
  } else {
    to = typeof args.to === "string" && args.to.trim() ? resolveDate(args.to, now) : wibDate(now);
    from = typeof args.from === "string" && args.from.trim() ? resolveDate(args.from, now) : wibDate(new Date(now.getTime() - 6 * 86_400_000));
  }
  if (from > to) throw new McpToolError("Tanggal awal tidak boleh setelah tanggal akhir.");
  if ((Date.parse(to) - Date.parse(from)) / 86_400_000 > 30) throw new McpToolError("Rentang tanggal maksimal 31 hari.");
  let limit = 50;
  if (args.limit !== undefined) {
    if (typeof args.limit !== "number" || !Number.isInteger(args.limit) || args.limit < 1 || args.limit > 100) throw new McpToolError("Parameter 'limit' harus bilangan bulat 1–100.");
    limit = args.limit;
  }
  const entries = await listClinicalEntries(ctx.config, { kind, from, to, status: "aktif", limit });
  try {
    await auditClinicalRead(ctx.config, { kind, reader: ctx.mode, count: entries.length, detail: { from, to, limit, ids: entries.map((entry) => entry.id) } });
  } catch {
    throw new McpToolError("Pencatatan audit pembacaan gagal; data klinis tidak dikirim. Coba lagi.");
  }
  return { status: "ok", dari: from, sampai: to, jumlah: entries.length, mungkin_terpotong: entries.length === limit, entri: entries.map(clinicalView) };
}

/** Board rows plus archived Task Vault updates, for tools that resolve the vault or build schedules from it. */
async function vaultInstructions(ctx: McpAuthContext, now: Date): Promise<BoardInstruction[]> {
  if (!ctx.config) return [];
  return vaultLedger(ctx.config, { now: now.toISOString() }).catch(() => [] as BoardInstruction[]);
}

async function safeInstructions(ctx: McpAuthContext, now: Date): Promise<BoardInstruction[]> {
  if (!ctx.config) return [];
  const res = await board(ctx.config, { now: now.toISOString() }).catch(() => ({ instructions: [] as BoardInstruction[] }));
  return res.instructions;
}

export async function executeMcpTool(
  name: string,
  args: Record<string, unknown>,
  ctx: McpAuthContext,
  now = new Date()
): Promise<unknown> {
  switch (name) {
    case "agent_overview": {
      try {
        const data = await getDashboardData();
        return {
          status: "ok",
          accessLevel: "ALL_ACCESS",
          iconUrl: MCP_LOGO_URL,
          mode: ctx.mode,
          callerAgent: ctx.agentId,
          documentCount: data.documentCount,
          validation: data.validation,
          toolCount: MCP_TOOLS.length,
        };
      } catch (error) {
        logError("mcp_agent_overview_degraded", error);
        return {
          status: "ok",
          accessLevel: "ALL_ACCESS",
          iconUrl: MCP_LOGO_URL,
          mode: ctx.mode,
          callerAgent: ctx.agentId,
          knowledgeIndexAvailable: false,
          documentCount: 0,
          toolCount: MCP_TOOLS.length,
        };
      }
    }

    case "daftar_dokumen":
    case "knowledge_list": {
      let docs = await loadKnowledgeDocuments();
      if (typeof args.category === "string" && args.category.trim()) {
        const cat = args.category.trim().toUpperCase();
        docs = docs.filter((d) => d.category === cat);
      }
      if (typeof args.domain === "string" && args.domain.trim()) {
        const dom = args.domain.trim().toLowerCase();
        docs = docs.filter((d) => d.domain.toLowerCase().includes(dom));
      }
      if (typeof args.department === "string" && args.department.trim()) {
        const dept = args.department.trim().toLowerCase();
        docs = docs.filter((d) => d.department.toLowerCase().includes(dept));
      }
      if (typeof args.q === "string" && args.q.trim()) {
        const q = args.q.trim().toLowerCase();
        docs = docs.filter((d) => d.title.toLowerCase().includes(q) || d.docId.toLowerCase().includes(q) || d.path.toLowerCase().includes(q));
      }
      const offset = typeof args.offset === "number" && Number.isFinite(args.offset) ? Math.max(0, Math.floor(args.offset)) : 0;
      const limit = typeof args.limit === "number" && Number.isFinite(args.limit) ? Math.min(200, Math.max(1, Math.floor(args.limit))) : 50;
      return {
        total: docs.length,
        offset,
        limit,
        documents: docs.slice(offset, offset + limit).map((doc) => ({
          path: doc.path,
          category: doc.category,
          title: doc.title,
          docId: doc.docId,
          domain: doc.domain,
          department: doc.department,
          lastReviewed: doc.lastReviewed,
          tags: doc.tags,
          ...(doc.aiFills ? { aiFills: doc.aiFills } : {}),
        })),
      };
    }

    case "cari_dokumen":
    case "knowledge_search": {
      if (typeof args.query !== "string" || !args.query.trim()) {
        throw new McpToolError("Parameter 'query' wajib diisi.");
      }
      const query = args.query.trim();
      const limit = typeof args.limit === "number" && Number.isFinite(args.limit) ? Math.min(50, Math.max(1, Math.floor(args.limit))) : 12;
      const [docs, retriever] = await Promise.all([loadKnowledgeDocuments(), sharedRetriever()]);
      const docHits = searchDocuments(docs, query, limit);
      const chunkHits = retriever.search(query, limit);
      return {
        query,
        documents: docHits,
        chunks: chunkHits.map(({ chunk, score }) => ({
          id: chunk.id,
          docId: chunk.docId,
          path: chunk.path,
          title: chunk.title,
          headingPath: chunk.headingPath,
          score,
          text: chunk.text,
        })),
      };
    }

    case "baca_dokumen":
    case "knowledge_get": {
      if (typeof args.path !== "string" || !args.path.trim()) {
        throw new McpToolError("Parameter 'path' wajib diisi.");
      }
      const target = args.path.trim().replace(/\\/g, "/").replace(/^\/+/, "");
      const [docs, chunks] = await Promise.all([loadKnowledgeDocuments(), loadKnowledgeChunks()]);
      const doc = docs.find(
        (d) =>
          d.path === target ||
          d.path === `knowledge/${target}` ||
          (d.docId && d.docId.toLowerCase() === target.toLowerCase())
      );
      if (!doc) {
        throw new McpToolError(`Dokumen '${target}' tidak ditemukan di indeks knowledge APPROVED.`);
      }
      const docChunks = chunks.filter((c) => c.path === doc.path);
      const { searchableText, ...meta } = doc;
      return {
        status: "ok",
        document: meta,
        content: docChunks.length > 0 ? docChunks.map((c) => `${c.headingPath.join(" > ")}\n${c.text}`).join("\n\n") : searchableText,
        chunkCount: docChunks.length,
      };
    }

    case "baca_jadwal":
    case "schedule_get": {
      const date = resolveDate(args.date, now);
      if (!ctx.config) {
        return {
          mode: "file",
          date,
          jadwal: buildFallbackBoardSchedule(date, []),
          officePlan: buildFallbackOfficePlan(date, []),
        };
      }
      const [dash, office] = await Promise.allSettled([listSchedule(ctx.config, { date }), readExecutivePlan(ctx.config, date)]);
      if (dash.status === "rejected" && office.status === "rejected") {
        const instructions = await vaultInstructions(ctx, now);
        const overrides = await readScheduleOverrides(ctx.config, date, "direktur");
        return {
          mode: "fallback",
          date,
          jadwal: buildFallbackBoardSchedule(date, instructions, overrides),
          officePlan: buildFallbackOfficePlan(date, instructions, overrides),
        };
      }
      return {
        mode: ctx.mode,
        date,
        jadwal: dash.status === "fulfilled" ? dash.value.items : null,
        rapat: office.status === "fulfilled" ? office.value.meetings : null,
      };
    }

    case "simpan_jadwal":
    case "schedule_replace": {
      let parsed;
      try {
        parsed = parseScheduleSubmission({ date: args.date, items: args.items });
      } catch (error) {
        throw new McpToolError(error instanceof Error ? error.message : "Format jadwal tidak valid.");
      }
      assertNoPhi(parsed);
      if (!ctx.config) {
        return {
          status: "accepted",
          mode: "file",
          date: parsed.date,
          count: parsed.items.length,
          items: parsed.items,
          producer: `mcp-${ctx.agentId.toLowerCase()}`,
        };
      }
      const result = await replaceSchedule(ctx.config, {
        date: parsed.date,
        items: parsed.items,
        producer: `mcp-${ctx.agentId.toLowerCase()}`,
      });
      return { status: "stored", ...result };
    }

    case "baca_jadwal_struktural": {
      const date = resolveDate(args.date, now);
      const role =
        typeof args.role === "string" && STRUCTURAL_ROLE_IDS.includes(args.role as StructuralRoleId)
          ? (args.role as StructuralRoleId)
          : "direktur";
      const instructions = await vaultInstructions(ctx, now);
      const rotation = leadBriefRotation(date);
      const overrides = await readScheduleOverrides(ctx.config, date, role);
      const { slots } = buildEnrichedScheduleForRole(date, role, instructions, overrides);
      return {
        tanggal: date,
        jabatan: role,
        pekan_lead_brief: rotation.weekIndex,
        pemimpin_lead_brief: rotation.leaderName,
        slot_jadwal: slots,
      };
    }

    case "baca_task_vault": {
      const instructions = await vaultInstructions(ctx, now);
      let tasks = resolveVaultTasks(instructions);
      if (typeof args.domain === "string" && args.domain.trim()) {
        const dom = args.domain.trim().toLowerCase();
        tasks = tasks.filter((t) => t.domain.toLowerCase().includes(dom));
      }
      if (typeof args.status === "string" && VAULT_STATUS_VALUES.includes(args.status as VaultTaskStatus)) {
        tasks = tasks.filter((t) => t.status === args.status);
      }
      if (typeof args.priority === "string" && ["P0", "P1", "P2"].includes(args.priority)) {
        tasks = tasks.filter((t) => t.priority === args.priority);
      }
      return { jumlah: tasks.length, tugas: tasks };
    }

    case "ubah_status_tugas": {
      const taskId = typeof args.task_id === "string" ? args.task_id.trim() : "";
      const requestedStatus = typeof args.status === "string" ? (args.status as VaultTaskStatus) : undefined;
      if (!taskId || !requestedStatus || !VAULT_STATUS_VALUES.includes(requestedStatus)) {
        throw new McpToolError("Parameter 'task_id' dan 'status' wajib diisi dengan nilai yang valid.");
      }
      const task = VAULT_TASKS.find((t) => t.id === taskId);
      if (!task) {
        throw new McpToolError(`Tugas '${taskId}' tidak ditemukan di Task Vault.`);
      }
      // Only the Director's own signed-in session may skip Rule #39; an agent token cannot grant itself that.
      const bypassRule39 = args.bypass_rule39 === true && ctx.mode === "director_session";
      const thirdPartyName = typeof args.pihak_ketiga === "string" ? args.pihak_ketiga : undefined;
      const note = typeof args.catatan === "string" ? args.catatan : undefined;
      assertNoPhi({ taskId, thirdPartyName, note });

      if (!ctx.config) {
        const resolvedStatus = applyRule39(requestedStatus, bypassRule39);
        const rule39Applied = resolvedStatus !== requestedStatus;
        const formattedNote = formatFeedbackNote({
          status: resolvedStatus,
          thirdPartyName: thirdPartyName ?? task.thirdPartyName,
          text:
            note?.trim() ||
            (rule39Applied
              ? "Dilaporkan selesai oleh staf; menunggu verifikasi dr. Novia (Rule #39)."
              : `Status diperbarui oleh ${ctx.agentId} menjadi ${resolvedStatus}.`),
        });
        return {
          status: "accepted",
          mode: "file",
          taskId,
          requestedStatus,
          resolvedStatus,
          rule39Applied,
          note: formattedNote,
        };
      }

      return submitVaultTaskFeedback(ctx.config, {
        date: wibDate(now),
        taskId,
        status: requestedStatus,
        thirdPartyName,
        note,
        actorRole: bypassRule39 ? "DIRECTOR" : "STAFF",
        actorLabel: `${ctx.agentId} (via All-Access MCP)`,
      });
    }

    case "baca_tugas": {
      const filter = typeof args.filter === "string" && (TASK_FILTERS as readonly string[]).includes(args.filter) ? args.filter : "semua";
      const instructions = await safeInstructions(ctx, now);
      const nowWib = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Jakarta", dateStyle: "short", timeStyle: "short" })
        .format(now)
        .replace(" ", "T");
      const rows = instructions.filter((row) => {
        const rules = forRules(row);
        if (isFinal(rules)) return false;
        if (filter === "lewat_tenggat") return isOverdue(rules, nowWib);
        return filter === "semua" || reminderState(rules, now) !== "none" || row.status === "terkendala";
      });
      return { mode: ctx.mode, jumlah: rows.length, tugas: rows };
    }

    case "buat_arahan": {
      const candidate = {
        reportDate: typeof args.reportDate === "string" && args.reportDate.trim() ? args.reportDate.trim() : wibDate(now),
        section: typeof args.section === "string" ? args.section : "umum",
        itemId: typeof args.itemId === "string" && args.itemId.trim() ? args.itemId.trim() : `MCP-${Date.now()}`,
        itemTitle: args.itemTitle,
        urgent: typeof args.urgent === "boolean" ? args.urgent : false,
        action: args.action,
        deadline: args.deadline ?? null,
        pic: Array.isArray(args.pic) ? args.pic : [],
        note: typeof args.note === "string" ? stripExecutiveTag(args.note) : "",
        decisionOptionId: null,
        decisionLabel: null,
        linkedId: null,
      };
      let parsed;
      try {
        parsed = parseInstructionInput(candidate);
      } catch {
        throw new McpToolError("Format arahan tidak valid.");
      }
      assertNoPhi(parsed);
      if (!ctx.config) {
        return {
          status: "accepted",
          mode: "file",
          instruction: {
            id: `IOC-FILE-${Date.now().toString().slice(-6)}`,
            ...parsed,
            status: "dibuat",
            history: [],
            createdAt: now.toISOString(),
          },
        };
      }
      const result = await ctx.config.store.call<{ instruction: Instruction; replayed: boolean }>(
        "create",
        {
          ...parsed,
          reviewerId: `${ctx.agentId} (MCP)`,
          key: `mcp-instr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          requestHash: canonicalHash(parsed),
        },
        "melinda_director_instructions"
      );
      return { status: "stored", ...result };
    }

    case "baca_morning_brief": {
      const date = resolveDate(args.date, now);
      return readMelindaBrief(date);
    }

    case "terbitkan_morning_brief": {
      const date = resolveDate(args.date, now);
      let payload;
      if (args.brief && typeof args.brief === "object") {
        try {
          payload = parseMelindaBrief(args.brief);
        } catch (error) {
          throw new McpToolError(error instanceof Error ? error.message : "Format Morning Brief tidak valid.");
        }
      } else {
        const instructions = await vaultInstructions(ctx, now);
        const snapRes = await readMedifySnapshot(date, now);
        const snapshot = snapRes.snapshot;
        const facts = snapshot ? detectFacts(snapshot) : [];
        payload = composeFullExecutiveBrief({
          date,
          snapshot,
          facts,
          narrative: null,
          instructions,
          roleId: "direktur",
          overrides: await readScheduleOverrides(ctx.config, date, "direktur"),
        });
      }
      assertNoPhi(payload);
      const docInput = {
        producerId: `mcp-${ctx.agentId.toLowerCase()}`,
        key: `mcp-brief-${date}-${canonicalHash(payload).slice(0, 16)}`,
        date: payload.dateIso,
        payload,
      };
      const receipt = ctx.config
        ? await submitDailyDocument(ctx.config, "management_brief", docInput)
        : await submitDailyDocumentFile("management_brief", docInput);
      return { status: "stored", receipt };
    }

    case "baca_warta": {
      const date = resolveDate(args.date, now);
      return readNewsEdition(date);
    }

    case "terbitkan_warta": {
      const date = resolveDate(args.date, now);
      let payload;
      if (args.edition && typeof args.edition === "object") {
        try {
          payload = parseNewsEdition(args.edition);
        } catch (error) {
          throw new McpToolError(error instanceof Error ? error.message : "Format Warta tidak valid.");
        }
      } else {
        const instructions = await vaultInstructions(ctx, now);
        const snapRes = await readMedifySnapshot(date, now);
        payload = composeNewsEdition({ date, snapshot: snapRes.snapshot, instructions, overrides: await readScheduleOverrides(ctx.config, date, "direktur") });
      }
      assertNoPhi(payload);
      const docInput = {
        producerId: `mcp-${ctx.agentId.toLowerCase()}`,
        key: `mcp-news-${date}-${canonicalHash(payload).slice(0, 16)}`,
        date: payload.date,
        payload,
      };
      const receipt = ctx.config
        ? await submitDailyDocument(ctx.config, "news_edition", docInput)
        : await submitDailyDocumentFile("news_edition", docInput);
      return { status: "stored", receipt };
    }

    case "baca_medify": {
      const date = resolveDate(args.date, now);
      const result = await readMedifySnapshot(date, now);
      if (!result.snapshot) return { status: result.status, pesan: result.message };
      const { bed, outpatient, igd, inpatient, patients } = result.snapshot;
      return {
        status: result.status,
        receivedAt: result.receivedAt,
        bed: bed?.wards.map((w) => ({ ruang: w.ward, kelas: w.kelas, terisi: w.occupied, kapasitas: w.capacity })) ?? null,
        rawat_jalan_hari_ini: outpatient?.visitsToday ?? null,
        igd_hari_ini: igd?.visitsToday ?? null,
        diagnosis_igd_terbanyak: igd?.topDiagnoses.slice(0, 5) ?? null,
        rawat_inap_hari_terakhir: inpatient?.daily.at(-1) ?? null,
        rawat_inap_bulan_ini: inpatient?.monthly.at(-1) ?? null,
        pasien_terdaftar: patients?.total ?? null,
      };
    }

    case "baca_handover":
      return readClinical("handover", args, ctx, now);
    case "baca_roster":
      return readClinical("roster", args, ctx, now);
    case "baca_insiden":
      return readClinical("insiden", args, ctx, now);

    case "sinkronkan_halaman": {
      const date = resolveDate(args.date, now);
      const snapRes = await readMedifySnapshot(date, now);
      if (ctx.config) {
        return syncTodayAllPages(ctx.config, date, snapRes.snapshot);
      }
      const resolved = resolveVaultTasks([]);
      const { slots, tasks } = buildEnrichedScheduleForRole(date, "direktur", []);
      const facts = snapRes.snapshot ? detectFacts(snapRes.snapshot) : [];
      const brief = composeFullExecutiveBrief({
        date,
        snapshot: snapRes.snapshot,
        facts,
        narrative: null,
        instructions: [],
        roleId: "direktur",
      });
      const edition = composeNewsEdition({ date, snapshot: snapRes.snapshot, instructions: [] });

      let briefComposed = false;
      try {
        await submitDailyDocumentFile("management_brief", {
          producerId: `mcp-${ctx.agentId.toLowerCase()}`,
          key: `sync-brief-${date}-${canonicalHash(brief).slice(0, 16)}`,
          date,
          payload: brief,
        });
        briefComposed = true;
      } catch (error) {
        logError("mcp_sync_brief", error);
      }

      let newsComposed = false;
      try {
        await submitDailyDocumentFile("news_edition", {
          producerId: `mcp-${ctx.agentId.toLowerCase()}`,
          key: `sync-news-${date}-${canonicalHash(edition).slice(0, 16)}`,
          date,
          payload: edition,
        });
        newsComposed = true;
      } catch (error) {
        logError("mcp_sync_news", error);
      }

      const openTasks = tasks.filter((t) => t.status !== "selesai");
      return {
        mode: "file",
        date,
        scheduleCount: slots.length,
        openTasksCount: openTasks.length,
        thirdPartyCount: resolved.filter((t) => t.status === "pending_pihak_ketiga").length,
        waitingNoviaCount: openTasks.filter((t) => t.status === "menunggu_verifikasi_novia").length,
        briefComposed,
        newsComposed,
      };
    }

    default:
      throw new McpToolError(`Tool '${name}' tidak ditemukan.`);
  }
}
