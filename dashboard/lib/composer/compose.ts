import { longDate, wibTime } from "../director/director-data";
import briefCopy from "@/data/content/brief-copy.json";
import { fill, isString, isStringArray, requireFields } from "@/lib/content/content-file";
import type { Instruction } from "../director/director-instructions";
import type { MedifySnapshot } from "../medify/medify-snapshot-contract";
import type { MelindaManagementMorningBrief } from "../melinda/melinda-brief-data";
import { findPatientIdentifiers } from "../phi-guard";
import type { SatusehatSnapshot } from "../satusehat/satusehat-snapshot-contract";
import { buildBaselineSchedule, leadBriefRotation, type StructuralRoleId } from "../work-schedule/baseline-schedule";
import { applyOverrides, type ScheduleOverride } from "../work-schedule/schedule-overrides";
import { injectTasksIntoSchedule, resolveVaultTasks } from "../work-schedule/task-vault";
import { SECTION_NAMES, type Fact } from "./facts";
import type { Narrative } from "./narrative";

export const STATUS_WITH_ANALYSIS = "Otomatis";
export const STATUS_WITHOUT_ANALYSIS = "Otomatis, tanpa analisis";

const NO_ANALYSIS = "Analisis belum tersedia.";
const MAX_FOLLOW_UPS = 20;
// Mirrors the limits and the control-character rule of `melinda-brief-contract.ts`, which does not export them.
const SHORT = 300;
const LONG = 2_000;
export const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const fits = (value: string, max: number) => value.trim() !== "" && value.length <= max && !CONTROL.test(value);
const rupiah = new Intl.NumberFormat("id-ID");

requireFields("brief-copy.json", "root", briefCopy, {
  safetyCatatan: isString,
  safetyAnalysis: isString,
  claimsCatatan: isString,
  claimsAnalysis: isString,
  staffingCatatan: isString,
  staffingAnalysis: isString,
  emailTriageCatatan: isString,
  dataLimitations: isStringArray,
  conclusion: isStringArray,
});

export function composeBrief(input: { snapshot: MedifySnapshot; satusehatSnapshot?: SatusehatSnapshot | null; facts: Fact[]; narrative: Narrative | null; openInstructions: { id: string; title: string; pic: string[] }[] }): MelindaManagementMorningBrief {
  const { snapshot, satusehatSnapshot = null, facts, openInstructions } = input;
  const date = longDate(snapshot.date);
  // A narrative that holds nothing is the same as no narrative.
  const given = input.narrative;
  const narrative = given !== null && (given.serviceSummary !== null || given.safetyQuality !== null || given.pharmacy !== null || given.staffing !== null || given.decisions.length > 0 || given.conclusion.length > 0) ? given : null;
  const analysed = narrative !== null;
  // A section's analysis is shown open on the page; a section without one carries no field.
  const analysis = (key: "safetyQuality" | "pharmacy" | "staffing") => {
    const text = narrative?.[key];
    return text ? { analisis: text } : {};
  };

  // A row stays out when it looks like patient data (counted) or breaks a contract limit (not counted). `texts` holds the row's required strings with their limits.
  let hidden = 0;
  const usable = (texts: [string, number][]) => {
    if (texts.some(([value]) => findPatientIdentifiers(value).length > 0)) { hidden += 1; return false; }
    return texts.every(([value, max]) => fits(value, max));
  };

  const exceptions = facts.filter((fact) => fact.section === "safetyQuality" && fact.severity !== "info" && usable([[fact.text, LONG]]))
    .map((fact, index) => ({ no: index + 1, eksepsi: fact.text, tindakLanjut: "Menunggu arahan Direktur." }));
  const claims = (snapshot.pharmacy?.stockByUnit ?? [])
    .map((unit) => ({ pos: unit.name, nilaiStatus: unit.rupiah === null ? "tidak tersedia" : `Rp ${rupiah.format(unit.rupiah)}`, catatan: "" }))
    .filter((item) => usable([[item.pos, SHORT], [item.nilaiStatus, LONG]]));
  const staff = (snapshot.staff?.byType ?? [])
    .map((type) => ({ pos: type.name, status: `${type.count} orang` }))
    .filter((item) => usable([[item.pos, SHORT], [item.status, LONG]]));
  const findings = (snapshot.run?.unavailableSections ?? [])
    .map((issue) => ({ temuan: `Tarikan ${SECTION_NAMES[issue.section] ?? issue.section} gagal`, keterangan: issue.reason }))
    .filter((item) => usable([[item.temuan, SHORT], [item.keterangan, LONG]]));
  const limitations = facts.filter((fact) => fact.kind === "data" && usable([[fact.text, LONG]])).map((fact) => fact.text);
  const followUps = openInstructions.slice(0, MAX_FOLLOW_UPS)
    .map((open) => ({ item: open.title, pemilikAgent: open.pic.length ? open.pic.join(" / ") : "-", instructionId: open.id }))
    .filter((item) => usable([[item.item, LONG], [item.pemilikAgent, SHORT]]))
    .map((item, index) => ({ no: index + 1, ...item }));

  return {
    docType: "Management Morning Brief",
    facility: "RSIA Melinda DHAI",
    title: "Management Morning Brief",
    date,
    dateIso: snapshot.date,
    sources: `${snapshot.run ? `Medify, tarikan ${wibTime(snapshot.run.completedAt).replace(":", ".")}` : "Medify"}${satusehatSnapshot ? " + Satu Sehat Kemenkes" : ""}`,
    status: analysed ? STATUS_WITH_ANALYSIS : STATUS_WITHOUT_ANALYSIS,
    catatanStatus: analysed ? "" : NO_ANALYSIS,
    untuk: "Direktur RSIA Melinda DHAI",
    disiapkanOleh: "Melinda (otomatis dari Medify)",
    nomorVersi: `MB-${snapshot.date}`,
    schedule: { headerRight: "", items: [], catatan: "Agenda belum dicatat di MelindaOS." },
    serviceSummary: { dateLabel: "Ringkasan layanan", sourceLabel: "Medify", content: narrative?.serviceSummary ?? NO_ANALYSIS, catatan: "" },
    safetyQuality: { headerRight: "", exceptions, catatan: "", ...analysis("safetyQuality") },
    claimsFinance: { headerRight: "", items: claims, catatan: "", ...analysis("pharmacy") },
    staffing: { headerRight: "", items: staff, catatan: "", ...analysis("staffing") },
    systemFindings: { headerRight: "", items: findings },
    emailTriage: { headerRight: "", data: null, unavailableReason: "Belum ada sumber otomatis untuk triase email." },
    decisions: {
      headerRight: "",
      items: (narrative?.decisions ?? []).map(({ kode, keputusan, rekomendasi }) => ({ kode, keputusan, rekomendasi, batas: "" })),
      catatan: "Usulan otomatis; berlaku setelah Direktur memutuskan.",
    },
    dataLimitations: {
      headerRight: "",
      items: [
        ...limitations,
        "Angka keuangan Medify belum ditampilkan: belum cocok dengan layar Keuangan Medify (27 Oktober 2026).",
        "Klaim per kasus belum punya sumber otomatis.",
        ...(hidden > 0 ? [`${hidden} baris disembunyikan karena menyerupai data pasien.`] : []),
      ],
    },
    followUps: { headerRight: "", items: followUps },
    conclusion: {
      headerRight: "",
      paragraphs: narrative === null ? [NO_ANALYSIS] : narrative.conclusion.length ? narrative.conclusion : ["Kesimpulan belum tersedia."],
      metadataRule: "",
    },
    runningFooter: { docNumber: `MB-${snapshot.date}`, notice: "Disusun otomatis; keputusan tetap pada Direktur." },
  };
}

export function composeFullExecutiveBrief(input: {
  date: string;
  snapshot: MedifySnapshot | null;
  satusehatSnapshot?: SatusehatSnapshot | null;
  facts: Fact[];
  narrative: Narrative | null;
  instructions: readonly Instruction[];
  roleId?: StructuralRoleId;
  overrides?: readonly ScheduleOverride[];
}): MelindaManagementMorningBrief {
  const { date, snapshot, satusehatSnapshot = null, facts, narrative, instructions, roleId = "direktur", overrides = [] } = input;
  const resolved = resolveVaultTasks(instructions);
  const rotation = leadBriefRotation(date);
  const baseline = applyOverrides(buildBaselineSchedule(date, roleId), overrides.filter((change) => change.role === roleId));
  const enrichedSchedule = injectTasksIntoSchedule(baseline, resolved);

  const openTasks = resolved.filter((t) => t.status !== "selesai");
  const thirdParty = openTasks.filter((t) => t.status === "pending_pihak_ketiga");
  const directorDecisions = openTasks.filter((t) => t.status === "butuh_keputusan_direktur");
  const waitingNovia = openTasks.filter((t) => t.status === "menunggu_verifikasi_novia");

  const scheduleItems = enrichedSchedule.map((slot) => ({
    waktu: slot.timeRange,
    kegiatan: slot.title,
    siapa: slot.participants.join(", "),
    topikTindakLanjut: slot.combinedTopicSummary.slice(0, LONG),
  }));

  const factExceptions = facts
    .filter((fact) => fact.section === "safetyQuality" && fact.severity !== "info" && fits(fact.text, LONG) && findPatientIdentifiers(fact.text).length === 0)
    .map((fact) => ({ eksepsi: fact.text, tindakLanjut: "Menunggu arahan Direktur." }));

  const vaultSafety = openTasks
    .filter((t) => t.domain === "Pelayanan" || t.domain === "Umum")
    .slice(0, 6)
    .map((t) => ({
      eksepsi: `[${t.id}] ${t.title} — ${t.summary}`.slice(0, LONG),
      tindakLanjut: `${t.evidenceRequired} (PIC: ${t.pic.join(", ")})`.slice(0, LONG),
    }));

  const exceptions = [...factExceptions, ...vaultSafety].map((item, idx) => ({ no: idx + 1, ...item }));

  const medifyClaims = (snapshot?.pharmacy?.stockByUnit ?? [])
    .map((unit) => ({ pos: unit.name, nilaiStatus: unit.rupiah === null ? "tidak tersedia" : `Rp ${rupiah.format(unit.rupiah)}`, catatan: "" }))
    .filter((item) => fits(item.pos, SHORT) && fits(item.nilaiStatus, LONG));

  const vaultClaims = openTasks
    .filter((t) => t.domain === "Keuangan" || t.domain === "Farmasi" || t.domain === "Casemix")
    .slice(0, 8)
    .map((t) => ({
      pos: `${t.id} · ${t.title}`.slice(0, SHORT),
      nilaiStatus:
        t.status === "pending_pihak_ketiga"
          ? `Pending pihak ke-3 (${t.thirdPartyName ?? "Eksternal"})`
          : t.status === "butuh_keputusan_direktur"
            ? "Menunggu keputusan Direktur"
            : "Berjalan",
      catatan: `${t.deadlineLabel} · PIC: ${t.pic.join(", ")}`.slice(0, LONG),
    }));

  const claims = [...medifyClaims, ...vaultClaims];

  const medifyStaff = (snapshot?.staff?.byType ?? [])
    .map((type) => ({ pos: type.name, status: `${type.count} orang` }))
    .filter((item) => fits(item.pos, SHORT) && fits(item.status, LONG));

  const vaultStaff = openTasks
    .filter((t) => t.domain === "SDM")
    .map((t) => ({
      pos: `${t.id} · ${t.title}`.slice(0, SHORT),
      status: `${t.deadlineLabel} (${t.pic.join(", ")})`.slice(0, LONG),
    }));

  const staff = [...medifyStaff, ...vaultStaff];

  const medifyFindings = (snapshot?.run?.unavailableSections ?? [])
    .map((issue) => ({ temuan: `Tarikan ${SECTION_NAMES[issue.section] ?? issue.section} gagal`, keterangan: issue.reason }))
    .filter((item) => fits(item.temuan, SHORT) && fits(item.keterangan, LONG));

  const vaultFindings = openTasks
    .filter((t) => t.domain === "IT")
    .map((t) => ({
      temuan: `${t.id} · ${t.title}`.slice(0, SHORT),
      keterangan: `${t.summary} (${t.thirdPartyBlocker ?? t.evidenceRequired})`.slice(0, LONG),
    }));

  const findings = [...medifyFindings, ...vaultFindings];

  const decisionItems = [
    ...(narrative?.decisions ?? []).map(({ kode, keputusan, rekomendasi }) => ({ kode, keputusan, rekomendasi, batas: "", urgent: true })),
    ...directorDecisions.map((t, index) => ({
      kode: (t.directorDecisionOption?.code ?? `DEC-${index + 1}`).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 20),
      keputusan: `${t.id}: ${t.title}`.slice(0, LONG),
      rekomendasi: (t.directorDecisionOption?.optionsLabel ?? t.summary).slice(0, LONG),
      batas: t.deadlineLabel.slice(0, SHORT),
      urgent: t.priority === "P0",
    })),
  ].slice(0, 12);

  // Deduplicate decision codes to satisfy parseMelindaBrief
  const seenCodes = new Set<string>();
  const uniqueDecisions = decisionItems.filter((item) => {
    if (seenCodes.has(item.kode)) return false;
    seenCodes.add(item.kode);
    return true;
  });

  const followUpItems = openTasks.slice(0, MAX_FOLLOW_UPS).map((t, idx) => ({
    no: idx + 1,
    item: `[${t.id}] ${t.title} — ${t.status === "pending_pihak_ketiga" ? `Pending ${t.thirdPartyName ?? "Pihak ke-3"}` : t.status === "menunggu_verifikasi_novia" ? "Menunggu verifikasi dr. Novia (Rule #39)" : t.deadlineLabel}`.slice(0, LONG),
    pemilikAgent: t.pic.join(" / ").slice(0, SHORT) || "-",
    ...(t.instructionId && /^IOC-\d{4,9}$/.test(t.instructionId) ? { instructionId: t.instructionId } : {}),
  }));

  const serviceSummaryContent =
    narrative?.serviceSummary ??
    `Ringkasan eksekutif ${longDate(date)}: ${openTasks.length} tugas aktif dipetakan ke jadwal 8 jabatan struktural (${thirdParty.length} tertahan pihak ke-3, ${directorDecisions.length} menunggu keputusan Direktur, ${waitingNovia.length} menunggu verifikasi dr. Novia sesuai Rule #39).`;

  return {
    docType: "Management Morning Brief",
    facility: "RSIA Melinda DHAI",
    title: "Management Morning Brief",
    date: longDate(date),
    dateIso: date,
    sources: `${snapshot?.run
      ? `Medify (${wibTime(snapshot.run.completedAt).replace(":", ".")}) + Task Vault + Jadwal Baseline`
      : "Task Vault + Jadwal Baseline 8 Jabatan Struktural"}${satusehatSnapshot ? " + Satu Sehat Kemenkes" : ""}`,
    status: narrative ? STATUS_WITH_ANALYSIS : STATUS_WITHOUT_ANALYSIS,
    catatanStatus: "",
    untuk: "Direktur RSIA Melinda DHAI",
    disiapkanOleh: "Melinda (Staf Khusus Penjadwalan Direktur)",
    nomorVersi: `MB-${date}`,
    schedule: {
      headerRight: `Pekan ${rotation.weekIndex} · Pemimpin Lead Brief: ${rotation.leaderName}`,
      items: scheduleItems,
      catatan: "Jadwal otomatis dari Pegangan Induk Struktural (17 PDF) yang disuntikkan bahan masalah aktif dari Task Vault.",
    },
    serviceSummary: {
      dateLabel: "Ringkasan layanan",
      sourceLabel: snapshot ? "Medify + Task Vault" : "Task Vault + Baseline",
      content: serviceSummaryContent.slice(0, LONG),
      catatan: "",
    },
    safetyQuality: {
      headerRight: `${exceptions.length} butir mutu & klinis aktif`,
      exceptions,
      catatan: briefCopy.safetyCatatan,
      analisis: narrative?.safetyQuality ?? briefCopy.safetyAnalysis,
    },
    claimsFinance: {
      headerRight: `${claims.length} pos klaim, farmasi & kas`,
      items: claims,
      catatan: briefCopy.claimsCatatan,
      analisis: narrative?.pharmacy ?? briefCopy.claimsAnalysis,
    },
    staffing: {
      headerRight: `${staff.length} isu SDM & formasi`,
      items: staff,
      catatan: briefCopy.staffingCatatan,
      analisis: narrative?.staffing ?? briefCopy.staffingAnalysis,
    },
    systemFindings: {
      headerRight: `${findings.length} temuan IT & SIMRS`,
      items: findings,
    },
    emailTriage: {
      headerRight: `${thirdParty.length} penantian pihak ke-3`,
      data: {
        accounts: [
          {
            akun: "Kemitraan & Pihak Ke-3 RSIA Melinda",
            total: thirdParty.length,
            perluTindakan: directorDecisions.length,
            fyi: waitingNovia.length,
            promoOtomatis: 0,
          },
        ],
        total: {
          total: thirdParty.length,
          perluTindakan: directorDecisions.length,
          fyi: waitingNovia.length,
          promoOtomatis: 0,
        },
        perluTindakanText: thirdParty.map((t) => `${t.thirdPartyName ?? t.domain}: ${t.title}`).join("; ").slice(0, LONG) || "Tidak ada hambatan pihak ke-3.",
        fyiItems: thirdParty.slice(0, 5).map((t) => `[${t.id}] ${t.thirdPartyName ?? t.domain} — ${t.thirdPartyBlocker ?? t.deadlineLabel}`.slice(0, LONG)),
        catatan: briefCopy.emailTriageCatatan,
      },
    },
    decisions: {
      headerRight: `${uniqueDecisions.length} butir menunggu Direktur`,
      items: uniqueDecisions,
      catatan: "Klik Kunci K/O/D atau sampaikan lewat /melinda untuk langsung menutup/mengubah status.",
    },
    dataLimitations: {
      headerRight: "",
      items: [...briefCopy.dataLimitations],
    },
    followUps: {
      headerRight: `${followUpItems.length} tindak lanjut aktif`,
      items: followUpItems,
    },
    conclusion: {
      headerRight: "",
      paragraphs:
        narrative?.conclusion && narrative.conclusion.length > 0
          ? narrative.conclusion
          : briefCopy.conclusion.map((text) =>
              fill(text, {
                mainForumTitle:
                  enrichedSchedule.find((s) => s.forumId.startsWith("tertutup_") || s.forumId === "sync_layanan_klaim")?.title ?? "Lead Brief 10.00",
                directorDecisionCount: directorDecisions.length,
              }),
            ),
      metadataRule: "Semua status terhubung langsung dengan buku besar Arahan Direktur & Agen /melinda.",
    },
    runningFooter: {
      docNumber: `MB-${date}`,
      notice: "Disusun otomatis oleh Staf Khusus Penjadwalan MelindaOS; keputusan tetap pada Direktur.",
    },
  };
}
