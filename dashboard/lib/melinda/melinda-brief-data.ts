export type MelindaScheduleEntry = {
  waktu: string;
  kegiatan: string;
  siapa: string;
  topikTindakLanjut: string;
  isPassed?: boolean;
};

export type MelindaSafetyException = {
  no: number;
  eksepsi: string;
  tindakLanjut: string;
};

export type MelindaClaimFinanceItem = {
  pos: string;
  nilaiStatus: string;
  catatan: string;
};

export type MelindaStaffingItem = {
  pos: string;
  status: string;
};

export type MelindaSystemFinding = {
  temuan: string;
  keterangan: string;
};

export type MelindaEmailTriageAccount = {
  akun: string;
  total: number;
  perluTindakan: number;
  fyi: number;
  promoOtomatis: number;
};

export type MelindaEmailTriage = {
  accounts: MelindaEmailTriageAccount[];
  total: { total: number; perluTindakan: number; fyi: number; promoOtomatis: number };
  perluTindakanText: string;
  fyiItems: string[];
  catatan: string;
};

export type MelindaPublicationSource = {
  sourceId: string;
  label: string;
  periodDate: string | null;
  observedAt: string | null;
  receivedAt: string | null;
  availability: "received" | "no_issues" | "unavailable" | "invalid" | "missing";
  revision: number | null;
  contentHash: string | null;
};

export type MelindaDecisionItem = {
  kode: string;
  keputusan: string;
  rekomendasi: string;
  batas: string;
  urgent?: boolean;
};

export type MelindaFollowUpItem = {
  no: number;
  item: string;
  pemilikAgent: string;
  /** Director instruction (`IOC-xxxx`) this follow-up carries forward; the page shows its live status. */
  instructionId?: string;
};

export type MelindaServiceIndicator = {
  indikator: string;
  nilai: string;
};

export type MelindaSimrsMetric = {
  kategori: string;
  indikator: string;
  nilai: string;
  statusBadge: "NORMAL" | "PERHATIAN" | "KRITIS" | "INFO";
  catatan: string;
};

export type MelindaSimrsPulse = {
  headerRight: string;
  systemUrl: string;
  platformVersion: string;
  syncStatus: string;
  metrics: MelindaSimrsMetric[];
  catatan?: string;
};

/** How an automatic brief was produced, stored beside the brief. Absent on manual briefs and on older payloads. */
export type ComposerStamp = {
  outcome: "stored" | "stored_without_analysis";
  at: string;
  modelCalled: boolean;
  facts: number;
  decisions: number;
};

export type MelindaManagementMorningBrief = {
  docType: string;
  facility: string;
  title: string;
  date: string;
  dateIso: string;
  sources: string;
  status: string;
  catatanStatus: string;
  untuk: string;
  disiapkanOleh: string;
  nomorVersi: string;
  systemDoctrine?: string;
  composer?: ComposerStamp;
  simrsPulse?: MelindaSimrsPulse;
  schedule: {
    headerRight: string;
    items: MelindaScheduleEntry[];
    catatan: string;
  };
  serviceSummary: {
    dateLabel: string;
    sourceLabel: string;
    content: string;
    catatan: string;
    /** Optional Indikator | Nilai rows. When absent, the brief table is derived from the Medify snapshot or from `content`. */
    items?: MelindaServiceIndicator[];
  };
  safetyQuality: {
    headerRight: string;
    exceptions: MelindaSafetyException[];
    catatan: string;
    /** Optional analysis paragraph, shown open under the heading. `catatan` stays the source note behind the info icon. */
    analisis?: string;
  };
  claimsFinance: {
    headerRight: string;
    items: MelindaClaimFinanceItem[];
    catatan: string;
    analisis?: string;
  };
  staffing: {
    headerRight: string;
    items: MelindaStaffingItem[];
    catatan: string;
    analisis?: string;
  };
  systemFindings: {
    headerRight: string;
    items: MelindaSystemFinding[];
  };
  emailTriage: {
    headerRight: string;
    data: MelindaEmailTriage | null;
    unavailableReason?: string;
  };
  decisions: {
    headerRight: string;
    items: MelindaDecisionItem[];
    catatan: string;
  };
  dataLimitations: {
    headerRight: string;
    items: string[];
  };
  followUps: {
    headerRight: string;
    items: MelindaFollowUpItem[];
  };
  conclusion: {
    headerRight: string;
    paragraphs: string[];
    metadataRule: string;
  };
  runningFooter: {
    docNumber: string;
    notice: string;
  };
  publication?: {
    revision: number;
    cutoffAt: string;
    semanticHash: string;
    previousSemanticHash: string | null;
    sources: MelindaPublicationSource[];
    changes: string[];
  };
};
