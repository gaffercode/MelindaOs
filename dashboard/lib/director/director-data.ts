export type Section<T> = { updatedAt: string | null; source: string; items: T[] };
export type ScheduleItem = { id: string; start: string; end: string; title: string; note: string };
export type PriorityItem = { id: string; title: string; note: string; urgent: boolean };
export type DirectorDecision = { id: string; title: string; note: string; options: { id: string; label: string }[] };
export type FollowUp = { id: string; title: string; status: string; pic: string; updatedAt: string };
export type DailyReport = { updatedAt: string | null; source: string; visits: number | null; bpjsSubmitted: number | null; bpjsPending: number | null; revenue: number | null; expenses: number | null };
export type ExecutiveBrief = {
  updatedAt: string; source: string; example: boolean;
  inpatient: { occupied: number | null; capacity: number | null; vacant: number | null; occupancyPercent: number | null; wards: { id: string; name: string; occupied: number | null; capacity: number | null; note: string }[] } | null;
  outpatient: { days: { date: string; total: number | null; obgyn: number | null; pediatrics: number | null }[]; pediatricsLast31Days: number | null; newPatientsPercent: number | null; payerMix: { cash: number | null; bpjs: number | null; insurance: number | null } | null } | null;
  emergency: { days: { date: string; visits: number | null; cutoff: string | null }[] } | null;
  systems: { id: string; title: string; detail: string; status: "warning" | "unavailable" }[];
  positiveNotes: string[]; validationNotes: string[];
};
export type QueueRoomSummary = { room: string; total: number; completed: number; waiting: number; newPatient: number; bpjs: number; general: number };
export type QueueSummary = { rooms: QueueRoomSummary[]; total: { total: number; completed: number; waiting: number; newPatient: number; bpjs: number; general: number }; note: string };
export type ClinicalPriorityPatient = { queueNumber: string; name: string; age: number; room: string; chronicTag: string; prb: string; prolanis: string };
export type ClinicalPriorities = { highlight: string; patients: ClinicalPriorityPatient[]; note: string };
export type ChronicPatientOtherRoom = { queueNumber: string; name: string; age: number; room: string; tag: string; note: string };
export type AdministrativeFinding = { id: string; text: string; actionRequired?: boolean };
/** Optional `clinicalBrief` section of the v2 submission contract. Kept for stored rows; the Puskesmas pages that rendered it moved to balowerti-os. */
export type ClinicalMorningBrief = {
  facility: string; docType: string; title: string; date: string; time: string; source: string; status: string;
  queueSummary: QueueSummary; clinicalPriorities: ClinicalPriorities; chronicPatientsOtherRooms: ChronicPatientOtherRoom[];
  administrativeFindings: AdministrativeFinding[]; dataLimitations: string[]; followUps: string[]; conclusion: string[]; disclaimer: string;
};
export type DirectorDay = {
  schemaVersion: 1 | 2; date: string;
  schedule: Section<ScheduleItem>; agenda: Section<ScheduleItem>;
  priorities: Section<PriorityItem>; decisions: Section<DirectorDecision>;
  followUps: Section<FollowUp>; dailyReport: DailyReport;
  brief?: ExecutiveBrief;
  clinicalBrief?: ClinicalMorningBrief;
};

export function validReportDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}

export function wibDate(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  return ["year", "month", "day"].map((key) => parts.find((part) => part.type === key)?.value).join("-");
}

export function wibTime(value: string): string {
  const parts = new Intl.DateTimeFormat("id-ID", { timeZone: "Asia/Jakarta", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(value));
  return `${parts.find((part) => part.type === "hour")?.value}:${parts.find((part) => part.type === "minute")?.value} WIB`;
}

export function longDate(value: string): string {
  return new Intl.DateTimeFormat("id-ID", { timeZone: "Asia/Jakarta", weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date(`${value}T00:00:00+07:00`));
}

export function emptyDirectorDay(date: string): DirectorDay {
  const section = <T,>(): Section<T> => ({ updatedAt: null, source: "Belum terhubung", items: [] });
  return { schemaVersion: 1, date, schedule: section(), agenda: section(), priorities: section(), decisions: section(), followUps: section(), dailyReport: { updatedAt: null, source: "Belum terhubung", visits: null, bpjsSubmitted: null, bpjsPending: null, revenue: null, expenses: null } };
}

function fail(): never { throw new Error("Format laporan harian tidak valid."); }
function object(value: unknown, fields: string[], optional: string[] = []): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail();
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => !fields.includes(key) && !optional.includes(key)) || fields.some((key) => !Object.hasOwn(record, key))) return fail();
  return record;
}
function text(value: unknown, optional = false): string {
  if (typeof value !== "string" || value.length > 500 || (!optional && !value.trim())) return fail();
  return value;
}
function id(value: unknown): string { const result = text(value); if (!/^[a-zA-Z0-9_-]{1,80}$/.test(result)) return fail(); return result; }
function timestamp(value: unknown): string {
  const result = text(value);
  if (!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/.test(result) || !validReportDate(result.slice(0, 10)) || !Number.isFinite(Date.parse(result))) return fail();
  return result;
}
function metadata(record: Record<string, unknown>) {
  return { updatedAt: record.updatedAt === null ? null : timestamp(record.updatedAt), source: text(record.source) };
}
function unique<T extends { id: string }>(items: T[]): T[] { if (new Set(items.map((item) => item.id)).size !== items.length) return fail(); return items; }
function section<T extends { id: string }>(value: unknown, parse: (value: unknown) => T): Section<T> {
  const record = object(value, ["updatedAt", "source", "items"]);
  if (!Array.isArray(record.items) || record.items.length > 100) return fail();
  const result = { ...metadata(record), items: unique(record.items.map(parse)) };
  if (result.items.length && !result.updatedAt) return fail();
  return result;
}
function schedule(value: unknown): ScheduleItem {
  const r = object(value, ["id", "start", "end", "title", "note"]);
  const start = text(r.start), end = text(r.end);
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(start) || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(end) || start >= end) return fail();
  return { id: id(r.id), start, end, title: text(r.title), note: text(r.note, true) };
}

export function parseDirectorDay(value: unknown, date: string): DirectorDay {
  const r = object(value, ["schemaVersion", "date", "schedule", "agenda", "priorities", "decisions", "followUps", "dailyReport"], ["brief", "clinicalBrief"]);
  if ((r.schemaVersion !== 1 && r.schemaVersion !== 2) || r.date !== date || !validReportDate(date)) return fail();
  const report = object(r.dailyReport, ["updatedAt", "source", "visits", "bpjsSubmitted", "bpjsPending", "revenue", "expenses"]);
  const number = (value: unknown): number | null => { if (value === null) return null; if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) return fail(); return value; };
  const dailyReport = { ...metadata(report), visits: number(report.visits), bpjsSubmitted: number(report.bpjsSubmitted), bpjsPending: number(report.bpjsPending), revenue: number(report.revenue), expenses: number(report.expenses) };
  if ([dailyReport.visits, dailyReport.bpjsSubmitted, dailyReport.bpjsPending, dailyReport.revenue, dailyReport.expenses].some((value) => value !== null) && !dailyReport.updatedAt) return fail();
  return {
    schemaVersion: r.schemaVersion, date,
    schedule: section(r.schedule, schedule), agenda: section(r.agenda, schedule),
    priorities: section(r.priorities, (value) => { const item = object(value, ["id", "title", "note", "urgent"]); if (typeof item.urgent !== "boolean") return fail(); return { id: id(item.id), title: text(item.title), note: text(item.note, true), urgent: item.urgent }; }),
    decisions: section(r.decisions, (value) => {
      const item = object(value, ["id", "title", "note", "options"]);
      if (!Array.isArray(item.options) || item.options.length < 2 || item.options.length > 6) return fail();
      return { id: id(item.id), title: text(item.title), note: text(item.note, true), options: unique(item.options.map((value) => { const option = object(value, ["id", "label"]); return { id: id(option.id), label: text(option.label) }; })) };
    }),
    followUps: section(r.followUps, (value) => { const item = object(value, ["id", "title", "status", "pic", "updatedAt"]); return { id: id(item.id), title: text(item.title), status: text(item.status), pic: text(item.pic), updatedAt: timestamp(item.updatedAt) }; }),
    dailyReport,
    ...(Object.hasOwn(r, "brief") ? { brief: parseExecutiveBrief(r.brief, date, r.schemaVersion === 2) } : {}),
    ...(Object.hasOwn(r, "clinicalBrief") ? { clinicalBrief: parseClinicalMorningBrief(r.clinicalBrief) } : {}),
  };
}

function count(value: unknown): number { if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) return fail(); return value; }
function percent(value: unknown): number { const result = count(value); if (result > 100) return fail(); return result; }
function list<T>(value: unknown, parse: (value: unknown) => T): T[] { if (!Array.isArray(value) || value.length > 100) return fail(); return value.map(parse); }
function parseExecutiveBrief(value: unknown, date: string, partial = false): ExecutiveBrief {
  const fields = ["inpatient", "outpatient", "emergency", "systems", "positiveNotes", "validationNotes"];
  const r = { ...object(value, partial ? ["updatedAt", "source", "example"] : ["updatedAt", "source", "example", ...fields], partial ? fields : []) };
  if (partial) for (const group of fields) if (!Object.hasOwn(r, group)) r[group] = ["systems", "positiveNotes", "validationNotes"].includes(group) ? [] : null;
  if (typeof r.example !== "boolean") return fail();
  const metric = (value: unknown) => partial && value === null ? null : count(value);
  const percentage = (value: unknown) => partial && value === null ? null : percent(value);
  const inpatient = r.inpatient === null && partial ? null : (() => {
  const beds = object(r.inpatient, ["occupied", "capacity", "vacant", "occupancyPercent", "wards"]);
  const occupied = metric(beds.occupied), capacity = metric(beds.capacity), vacant = metric(beds.vacant), occupancyPercent = percentage(beds.occupancyPercent);
  if ((!partial && !capacity) || (capacity !== null && occupied !== null && occupied > capacity) || (capacity !== null && vacant !== null && vacant > capacity) || (occupied !== null && vacant !== null && capacity !== null && occupied + vacant !== capacity) || (capacity !== null && occupied !== null && occupancyPercent !== null && (!capacity || occupancyPercent !== Math.round(occupied / capacity * 100)))) return fail();
  const wards = unique(list(beds.wards, (value) => {
    const ward = object(value, ["id", "name", "occupied", "capacity", "note"]);
    const occupied = metric(ward.occupied), capacity = ward.capacity === null ? null : count(ward.capacity);
    if (capacity !== null && occupied !== null && occupied > capacity) return fail();
    return { id: id(ward.id), name: text(ward.name), occupied, capacity, note: text(ward.note, true) };
  }));
  if ((occupied !== null && wards.reduce((total, ward) => total + (ward.occupied ?? 0), 0) > occupied) || (capacity !== null && wards.reduce((total, ward) => total + (ward.capacity ?? 0), 0) > capacity)) return fail();
  return { occupied, capacity, vacant, occupancyPercent, wards };
  })();
  function reportDate(value: unknown) { const result = text(value); if (!validReportDate(result) || result > date) return fail(); return result; }
  const outpatient = r.outpatient === null && partial ? null : (() => {
  const record = object(r.outpatient, ["days", "pediatricsLast31Days", "newPatientsPercent", "payerMix"]);
  const days = list(record.days, (value) => {
    const item = object(value, ["date", "total", "obgyn", "pediatrics"]);
    const total = metric(item.total), obgyn = metric(item.obgyn), pediatrics = metric(item.pediatrics);
    if (total !== null && (obgyn ?? 0) + (pediatrics ?? 0) > total) return fail();
    return { date: reportDate(item.date), total, obgyn, pediatrics };
  });
  if (new Set(days.map((item) => item.date)).size !== days.length) return fail();
  const mix = record.payerMix === null && partial ? null : object(record.payerMix, ["cash", "bpjs", "insurance"]);
  return { days, pediatricsLast31Days: metric(record.pediatricsLast31Days), newPatientsPercent: percentage(record.newPatientsPercent), payerMix: mix === null ? null : { cash: metric(mix.cash), bpjs: metric(mix.bpjs), insurance: metric(mix.insurance) } };
  })();
  const emergency = r.emergency === null && partial ? null : (() => {
  const record = object(r.emergency, ["days"]);
  const emergencyDays = list(record.days, (value) => {
    const item = object(value, ["date", "visits", "cutoff"]);
    const cutoff = item.cutoff === null ? null : text(item.cutoff);
    if (cutoff !== null && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(cutoff)) return fail();
    return { date: reportDate(item.date), visits: metric(item.visits), cutoff };
  });
  if (new Set(emergencyDays.map((item) => item.date)).size !== emergencyDays.length) return fail();
  return { days: emergencyDays };
  })();
  return {
    updatedAt: timestamp(r.updatedAt), source: text(r.source), example: r.example,
    inpatient, outpatient, emergency,
    systems: unique(list(r.systems, (value) => { const item = object(value, ["id", "title", "detail", "status"]); if (item.status !== "warning" && item.status !== "unavailable") return fail(); return { id: id(item.id), title: text(item.title), detail: text(item.detail), status: item.status }; })),
    positiveNotes: list(r.positiveNotes, (value) => text(value)), validationNotes: list(r.validationNotes, (value) => text(value)),
  };
}

export function parseClinicalMorningBrief(value: unknown): ClinicalMorningBrief {
  const r = object(value, [
    "facility", "docType", "title", "date", "time", "source", "status",
    "queueSummary", "clinicalPriorities", "chronicPatientsOtherRooms",
    "administrativeFindings", "dataLimitations", "followUps", "conclusion", "disclaimer"
  ]);

  const queueObj = object(r.queueSummary, ["rooms", "total", "note"]);
  const rooms = list(queueObj.rooms, (item) => {
    const row = object(item, ["room", "total", "completed", "waiting", "newPatient", "bpjs", "general"]);
    return {
      room: text(row.room),
      total: count(row.total),
      completed: count(row.completed),
      waiting: count(row.waiting),
      newPatient: count(row.newPatient),
      bpjs: count(row.bpjs),
      general: count(row.general),
    };
  });
  const totalObj = object(queueObj.total, ["total", "completed", "waiting", "newPatient", "bpjs", "general"]);
  const queueSummary: QueueSummary = {
    rooms,
    total: {
      total: count(totalObj.total),
      completed: count(totalObj.completed),
      waiting: count(totalObj.waiting),
      newPatient: count(totalObj.newPatient),
      bpjs: count(totalObj.bpjs),
      general: count(totalObj.general),
    },
    note: text(queueObj.note, true),
  };

  const prioObj = object(r.clinicalPriorities, ["highlight", "patients", "note"]);
  const patients = list(prioObj.patients, (item) => {
    const p = object(item, ["queueNumber", "name", "age", "room", "chronicTag", "prb", "prolanis"]);
    return {
      queueNumber: text(p.queueNumber),
      name: text(p.name),
      age: count(p.age),
      room: text(p.room),
      chronicTag: text(p.chronicTag),
      prb: text(p.prb),
      prolanis: text(p.prolanis),
    };
  });
  const clinicalPriorities: ClinicalPriorities = {
    highlight: text(prioObj.highlight),
    patients,
    note: text(prioObj.note, true),
  };

  const chronicPatientsOtherRooms = list(r.chronicPatientsOtherRooms, (item) => {
    const c = object(item, ["queueNumber", "name", "age", "room", "tag", "note"]);
    return {
      queueNumber: text(c.queueNumber),
      name: text(c.name),
      age: count(c.age),
      room: text(c.room),
      tag: text(c.tag),
      note: text(c.note, true),
    };
  });

  const administrativeFindings = list(r.administrativeFindings, (item) => {
    const f = object(item, ["id", "text"], ["actionRequired"]);
    return {
      id: id(f.id),
      text: text(f.text),
      actionRequired: typeof f.actionRequired === "boolean" ? f.actionRequired : false,
    };
  });

  return {
    facility: text(r.facility),
    docType: text(r.docType),
    title: text(r.title),
    date: text(r.date),
    time: text(r.time),
    source: text(r.source),
    status: text(r.status),
    queueSummary,
    clinicalPriorities,
    chronicPatientsOtherRooms,
    administrativeFindings,
    dataLimitations: list(r.dataLimitations, (item) => text(item)),
    followUps: list(r.followUps, (item) => text(item)),
    conclusion: list(r.conclusion, (item) => text(item)),
    disclaimer: text(r.disclaimer),
  };
}
