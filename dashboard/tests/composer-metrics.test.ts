import { describe, expect, it } from "vitest";
import { METRICS, metric } from "@/lib/composer/metrics";

describe("brief metric list", () => {
  it("lists twelve metrics with unique ids; only BOR and the SATUSEHAT share carry a threshold", () => {
    expect(METRICS).toHaveLength(12);
    expect(new Set(METRICS.map((m) => m.id)).size).toBe(12);
    expect(METRICS.filter((m) => m.threshold).map((m) => m.id)).toEqual(["bor", "satusehat_sent_percent"]);
    expect(metric("bor").threshold).toEqual({ perhatian: 85, direction: "above" });
    expect(metric("satusehat_sent_percent").threshold).toEqual({ perhatian: 95, direction: "below" });
    expect(metric("ndr").section).toBe("safetyQuality");
  });
});
