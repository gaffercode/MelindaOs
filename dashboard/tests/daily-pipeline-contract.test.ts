import { describe, expect, it } from "vitest";
import {
  DailyPipelineValidationError,
  parseDailyPipelineRegistry,
  parseSourceReport,
  semanticReportHash,
} from "@/lib/daily/daily-pipeline-contract";

const registry = {
  timezone: "Asia/Jakarta",
  schedules: { collect: "06:30", prepare: "07:45", publish: "07:50", alert: "09:00", revisions: ["12:00", "16:00"] },
  sources: [
    { id: "simrs", label: "Sensus SIMRS", kind: "simrs_export", required: true, period: "same_day", section: "simrsPulse", picRelayTarget: null, numericFields: [] },
    { id: "sdm", label: "SDM", kind: "unit_report", required: true, period: "previous_day", section: "staffing", picRelayTarget: "relay:sdm", numericFields: [{ key: "hadir", label: "Petugas hadir", minimum: 0 }] },
  ],
};

function report(overrides: Record<string, unknown> = {}) {
  return {
    sourceId: "sdm",
    reportDate: "2026-10-27",
    periodDate: "2026-10-26",
    observedAt: "2026-10-27T06:20:00+07:00",
    availability: "received",
    issues: "Tidak ada kendala",
    followUp: "",
    decisionNeeded: "",
    metrics: { hadir: 12 },
    ...overrides,
  };
}

describe("daily pipeline closed contracts", () => {
  it("accepts the configured WIB schedule and source registry", () => {
    expect(parseDailyPipelineRegistry(registry).sources.map((source) => source.id)).toEqual(["simrs", "sdm"]);
  });

  it("rejects unknown registry fields and an empty production roster", () => {
    expect(() => parseDailyPipelineRegistry({ ...registry, surprise: true })).toThrow(DailyPipelineValidationError);
    expect(() => parseDailyPipelineRegistry({ ...registry, sources: [] })).toThrowError(/sources/);
  });

  it("binds source periods, rejects future observation and patient identifiers", () => {
    const source = parseDailyPipelineRegistry(registry).sources[1];
    expect(parseSourceReport(report(), source, new Date("2026-10-27T00:00:00Z")).metrics).toEqual({ hadir: 12 });
    expect(() => parseSourceReport(report({ periodDate: "2026-10-27" }), source, new Date("2026-10-27T00:00:00Z"))).toThrowError(/periodDate/);
    expect(() => parseSourceReport(report({ observedAt: "2026-10-28T08:00:00+07:00" }), source, new Date("2026-10-27T00:00:00Z"))).toThrowError(/observedAt/);
    expect(() => parseSourceReport(report({ issues: "NIK 3210123456789012 perlu diperiksa" }), source, new Date("2026-10-27T00:00:00Z"))).toThrowError(/patient_identifier/);
  });

  it("requires offset timestamps and refuses a stale observation claimed as today's snapshot", () => {
    const parsed = parseDailyPipelineRegistry(registry);
    expect(() => parseSourceReport(report({ observedAt: "2026-10-26T06:30:00" }), parsed.sources[1], new Date("2026-10-27T00:00:00Z"))).toThrowError(/observedAt/);
    expect(() => parseSourceReport(report({ sourceId: "simrs", periodDate: "2026-10-27", observedAt: "2026-10-26T06:30:00+07:00", metrics: {} }), parsed.sources[0], new Date("2026-10-27T00:00:00Z"))).toThrowError(/observedAt/);
    expect(parseSourceReport(report(), parsed.sources[1], new Date("2026-10-27T00:00:00Z")).periodDate).toBe("2026-10-26");
  });

  it("keeps no-issues distinct from numeric zero and excludes retry timestamps from semantic hashes", () => {
    const source = parseDailyPipelineRegistry(registry).sources[1];
    const first = parseSourceReport(report({ availability: "no_issues", metrics: {} }), source, new Date("2026-10-27T00:00:00Z"));
    expect(first.metrics).toEqual({});
    expect(semanticReportHash({ ...first, receivedAt: "2026-10-27T00:00:00Z" })).toBe(
      semanticReportHash({ ...first, receivedAt: "2026-10-27T01:00:00Z" }),
    );
    expect(semanticReportHash(first)).toBe(semanticReportHash({ ...first, observedAt: "2026-10-27T06:30:00+07:00" }));
  });

  it("rejects foreign report fields and undeclared metrics", () => {
    const source = parseDailyPipelineRegistry(registry).sources[1];
    expect(() => parseSourceReport(report({ patientName: "Siti" }), source, new Date("2026-10-27T00:00:00Z"))).toThrowError(/patientName/);
    expect(() => parseSourceReport(report({ metrics: { hadir: 12, pasien: 1 } }), source, new Date("2026-10-27T00:00:00Z"))).toThrowError(/metrics\.pasien/);
  });

  it("preserves a sanitized same-date SIMRS snapshot and refuses it on unit sources", () => {
    const parsed = parseDailyPipelineRegistry(registry);
    const snapshot = { tanggal: "2026-10-27", diamatiPada: "2026-10-27T06:35:00+07:00", headerRight: "MEDIFY", syncStatus: "Ekspor", catatan: "Agregat", metrics: [{ kategori: "RAWAT INAP", indikator: "Sensus", nilai: "28", statusBadge: "INFO", catatan: "Agregat" }] };
    const simrs = parseSourceReport({ ...report({ sourceId: "simrs", periodDate: "2026-10-27", observedAt: "2026-10-27T06:35:00+07:00", metrics: {} }), snapshot }, parsed.sources[0], new Date("2026-10-27T00:00:00Z"));
    expect(structuredClone(simrs).snapshot).toEqual(snapshot);
    expect(() => parseSourceReport({ ...report(), snapshot }, parsed.sources[1], new Date("2026-10-27T00:00:00Z"))).toThrowError(/snapshot/);
  });
});
