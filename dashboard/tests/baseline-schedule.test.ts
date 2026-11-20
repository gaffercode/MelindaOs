import { describe, expect, it } from "vitest";
import {
  STRUCTURAL_ROLES,
  buildBaselineSchedule,
  leadBriefRotation,
} from "../lib/work-schedule/baseline-schedule";

describe("baseline-schedule", () => {
  it("defines all 8 structural roles across 7 officials", () => {
    expect(STRUCTURAL_ROLES).toHaveLength(8);
    const ids = STRUCTURAL_ROLES.map((r) => r.id);
    expect(ids).toEqual([
      "direktur",
      "wadir_ops",
      "wadir_keu_sdm",
      "kabag_pelayanan",
      "kabag_umum",
      "kabag_penunjang",
      "kepala_sdm",
      "kepala_keuangan",
    ]);

    const oriUmum = STRUCTURAL_ROLES.find((r) => r.id === "kabag_umum");
    const oriSdm = STRUCTURAL_ROLES.find((r) => r.id === "kepala_sdm");
    // One person holds both posts; the repository's roles are fictional (dashboard/data/content/baseline-schedule.json).
    expect(oriUmum?.officialName).toBe(oriSdm?.officialName);
  });

  it("computes the 3-week Lead Brief rotation anchored on 2026-09-07", () => {
    expect(leadBriefRotation("2026-09-07")).toEqual({
      weekIndex: 1,
      leaderName: "dr. Contoh Direktur",
      leaderRole: "direktur",
      dayNameId: "Senin",
    });
    expect(leadBriefRotation("2026-09-08").leaderRole).toBe("wadir_ops");
    expect(leadBriefRotation("2026-09-09").leaderRole).toBe("wadir_keu_sdm");
    expect(leadBriefRotation("2026-09-14")).toEqual({
      weekIndex: 2,
      leaderName: "Ibu Contoh Wadir Keu",
      leaderRole: "wadir_keu_sdm",
      dayNameId: "Senin",
    });
    expect(leadBriefRotation("2026-09-21")).toEqual({
      weekIndex: 3,
      leaderName: "dr. Contoh Wadir Ops",
      leaderRole: "wadir_ops",
      dayNameId: "Senin",
    });
  });

  it("builds Monday Director schedule including Pleno Senin and Tertutup Pelayanan", () => {
    const monday = buildBaselineSchedule("2026-11-16", "direktur");
    const forumIds = monday.map((s) => s.forumId);
    expect(forumIds).toContain("baca_pre_brief");
    expect(forumIds).toContain("lead_brief");
    expect(forumIds).toContain("visite_prioritas");
    expect(forumIds).toContain("decision_log");
    expect(forumIds).toContain("pleno_senin");
    expect(forumIds).toContain("jeda_dilindungi");
    expect(forumIds).toContain("tertutup_pelayanan");
    expect(forumIds).toContain("update_sore_wadir");
  });

  it("builds Thursday Director schedule with Tertutup Keuangan/SDM and Tuesday Wadir Ops with Sync Layanan-Klaim", () => {
    const thursday = buildBaselineSchedule("2026-11-19", "direktur");
    expect(thursday.some((s) => s.forumId === "tertutup_keuangan_sdm")).toBe(true);

    const tuesdayOps = buildBaselineSchedule("2026-11-17", "wadir_ops");
    expect(tuesdayOps.some((s) => s.forumId === "sync_layanan_klaim")).toBe(true);
    expect(tuesdayOps.some((s) => s.forumId === "tertutup_penunjang")).toBe(true);
  });

  it("unifies Ibu Oriza's calendar for Umum and SDM without conflicting time slots", () => {
    const umum = buildBaselineSchedule("2026-11-18", "kabag_umum");
    const sdm = buildBaselineSchedule("2026-11-18", "kepala_sdm");
    expect(umum.some((s) => s.forumId === "forum_b_ops")).toBe(true);
    expect(umum.some((s) => s.forumId === "forum_c_sdm")).toBe(true);
    expect(umum.map((s) => s.id)).toEqual(sdm.map((s) => s.id));
  });

  it("returns a clean weekend monitoring schedule for Saturday and Sunday", () => {
    const sunday = buildBaselineSchedule("2026-11-15", "direktur");
    expect(sunday.length).toBeGreaterThanOrEqual(3);
    expect(sunday[0]?.timeRange).toMatch(/\d{2}\.\d{2}/);
  });
});
