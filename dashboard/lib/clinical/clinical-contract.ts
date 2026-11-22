import {
  CLINICAL_KINDS,
  CLINICAL_STATUSES,
  INCIDENT_GRADES,
  INCIDENT_PROGRESS,
  INCIDENT_TYPES,
  SHIFTS,
  type ClinicalDraft,
  type ClinicalKind,
  type ClinicalStatus,
  type HandoverPayload,
  type IncidentPayload,
  type PayloadFor,
  type RosterPayload,
  type Shift,
} from "./clinical-types";

/** A rejected clinical payload. `path` names the field, never its content. */
export class ClinicalValidationError extends Error {
  override readonly name = "ClinicalValidationError";
  constructor(public readonly path: string) {
    super(path);
  }
}

const fail = (path: string): never => {
  throw new ClinicalValidationError(path);
};
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function text(value: unknown, path: string, max: number, required = false): string {
  if (value === undefined || value === null) {
    if (required) fail(path);
    return "";
  }
  if (typeof value !== "string") return fail(path);
  const clean = value.trim();
  if (clean.length > max || (required && clean.length === 0)) return fail(path);
  return clean;
}

function oneOf<T extends string>(value: unknown, path: string, allowed: readonly T[]): T {
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) return fail(path);
  return value as T;
}

function isoDate(value: unknown, path: string): string {
  const clean = text(value, path, 10, true);
  const parsed = /^(\d{4})-(\d{2})-(\d{2})$/.exec(clean);
  if (!parsed) return fail(path);
  const day = new Date(Date.UTC(Number(parsed[1]), Number(parsed[2]) - 1, Number(parsed[3])));
  if (day.toISOString().slice(0, 10) !== clean) return fail(path);
  return clean;
}

function clock(value: unknown, path: string): string {
  const clean = text(value, path, 5, true);
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(clean)) return fail(path);
  return clean;
}

function parseHandover(value: unknown): HandoverPayload {
  if (!isRecord(value)) return fail("payload");
  return {
    patient: text(value.patient, "payload.patient", 120, true),
    rm: text(value.rm, "payload.rm", 30),
    room: text(value.room, "payload.room", 60),
    situation: text(value.situation, "payload.situation", 1000, true),
    background: text(value.background, "payload.background", 1000),
    assessment: text(value.assessment, "payload.assessment", 1000),
    recommendation: text(value.recommendation, "payload.recommendation", 1000),
    pending: text(value.pending, "payload.pending", 500),
    from: text(value.from, "payload.from", 80, true),
    to: text(value.to, "payload.to", 80, true),
  };
}

function parseRoster(value: unknown): RosterPayload {
  if (!isRecord(value)) return fail("payload");
  if (!Array.isArray(value.people) || value.people.length === 0 || value.people.length > 40) return fail("payload.people");
  const people = value.people.map((person, index) => {
    if (!isRecord(person)) return fail(`payload.people.${index}`);
    return {
      name: text(person.name, `payload.people.${index}.name`, 80, true),
      role: text(person.role, `payload.people.${index}.role`, 60),
    };
  });
  return { people, notes: text(value.notes, "payload.notes", 500) };
}

function parseIncident(value: unknown): IncidentPayload {
  if (!isRecord(value)) return fail("payload");
  return {
    time: clock(value.time, "payload.time"),
    place: text(value.place, "payload.place", 100, true),
    type: oneOf(value.type, "payload.type", INCIDENT_TYPES),
    grade: oneOf(value.grade, "payload.grade", INCIDENT_GRADES),
    chronology: text(value.chronology, "payload.chronology", 2000, true),
    followUp: text(value.followUp, "payload.followUp", 1000),
    progress: oneOf(value.progress, "payload.progress", INCIDENT_PROGRESS),
    reporter: text(value.reporter, "payload.reporter", 80, true),
  };
}

const PARSERS: { [K in ClinicalKind]: (value: unknown) => PayloadFor[K] } = {
  handover: parseHandover,
  roster: parseRoster,
  insiden: parseIncident,
};

/** The payload alone, for a stored row or an edit whose kind is already known. */
export function parseClinicalPayload<K extends ClinicalKind>(kind: K, value: unknown): PayloadFor[K] {
  return PARSERS[kind](value);
}

export function parseClinicalKind(value: unknown): ClinicalKind {
  return oneOf(value, "kind", CLINICAL_KINDS);
}

export function parseClinicalStatus(value: unknown): ClinicalStatus {
  return oneOf(value, "status", CLINICAL_STATUSES);
}

export function parseClinicalDate(value: unknown, path = "date"): string {
  return isoDate(value, path);
}

function parseShift(value: unknown): Shift | null {
  if (value === undefined || value === null || value === "") return null;
  return oneOf(value, "shift", SHIFTS);
}

/**
 * Deep validation for a new entry. The browser form is a convenience; this function is the boundary.
 * Unknown keys are ignored and every accepted key is bounded. Handover and roster need a shift.
 */
export function parseClinicalDraft(value: unknown): ClinicalDraft {
  if (!isRecord(value)) return fail("draft");
  const kind = parseClinicalKind(value.kind);
  const shift = parseShift(value.shift);
  if (kind !== "insiden" && shift === null) return fail("shift");
  const base = { date: isoDate(value.date, "date"), shift, unit: text(value.unit, "unit", 60, true) };
  if (kind === "handover") return { kind, ...base, payload: parseHandover(value.payload) };
  if (kind === "roster") return { kind, ...base, payload: parseRoster(value.payload) };
  return { kind, ...base, payload: parseIncident(value.payload) };
}
