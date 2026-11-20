import { readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MIGRATION_NAMES } from "@/lib/migration-names";

const MIGRATIONS = path.resolve(__dirname, "../supabase/migrations");
const NAME_PATTERN = /^\d{12}_[a-z0-9_]+$/;

const onDisk = readdirSync(MIGRATIONS)
  .filter((file) => file.endsWith(".sql"))
  .map((file) => file.slice(0, -".sql".length))
  .sort();

describe("migration names", () => {
  it("names every migration file as a 12-digit version, an underscore and a lowercase slug", () => {
    const offenders = onDisk.filter((name) => !NAME_PATTERN.test(name));
    expect(offenders, `Bad migration file names: ${offenders.map((name) => `${name}.sql`).join(", ")}`).toEqual([]);
  });

  it("keeps MIGRATION_NAMES equal to the migrations folder", () => {
    const missing = onDisk.filter((name) => !MIGRATION_NAMES.includes(name));
    const stale = MIGRATION_NAMES.filter((name) => !onDisk.includes(name));
    expect(
      { missing, stale },
      `Update lib/migration-names.ts. Missing from the list: ${missing.join(", ") || "none"}. In the list with no file: ${stale.join(", ") || "none"}.`,
    ).toEqual({ missing: [], stale: [] });
    expect([...MIGRATION_NAMES]).toEqual(onDisk);
  });

  it("uses each 12-digit version once", () => {
    const versions = onDisk.map((name) => name.slice(0, 12));
    const repeated = versions.filter((version, index) => versions.indexOf(version) !== index);
    expect(repeated, `Repeated migration versions: ${repeated.join(", ")}`).toEqual([]);
  });
});
