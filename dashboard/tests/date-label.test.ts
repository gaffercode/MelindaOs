import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { formatUtcDayMonth, formatUtcMonthYear } from "@/lib/date-label";

describe("formatUtcMonthYear", () => {
  it("renders a YYYY-MM key as an Indonesian short month and year", () => {
    expect(formatUtcMonthYear("2026-01")).toBe("Jan 2026");
    expect(formatUtcMonthYear("2098-12")).toBe("Des 2098");
  });
});

describe("formatUtcDayMonth", () => {
  it("renders a date-only value as an Indonesian day and short month in UTC", () => {
    expect(formatUtcDayMonth("2026-01-01")).toBe("1 Jan");
    expect(formatUtcDayMonth("2024-02-29")).toBe("29 Feb");
    expect(formatUtcDayMonth("2026-12-31")).toBe("31 Des");
  });

  it("keeps the Intl RangeError for input that is not a date", () => {
    expect(() => formatUtcDayMonth("not-a-date")).toThrow(RangeError);
  });

  // Last in the file: Node keeps the new zone cached after TZ is restored, so nothing may run after this block.
  describe("on a host west of UTC", () => {
    const hostTz = process.env.TZ;
    beforeAll(() => { process.env.TZ = "America/New_York"; });
    afterAll(() => { if (hostTz === undefined) delete process.env.TZ; else process.env.TZ = hostTz; });

    it("still labels the UTC day, not the host's previous day", () => {
      expect(formatUtcDayMonth("2026-01-01")).toBe("1 Jan");
      expect(formatUtcDayMonth("2026-12-31")).toBe("31 Des");
    });
  });
});
