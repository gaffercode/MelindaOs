import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

type MigrateDoctor = {
  report: (names: string[], versions: string[]) => { recorded: string[]; missing: string[] };
  ledgerVersions: (answer: unknown) => string[] | null;
};

describe("migrate-doctor", () => {
  it("report returns the missing migrations", async () => {
    const mod = (await import("@/scripts/migrate-doctor.mjs")) as MigrateDoctor;
    const names = ["202610030001_director", "202611120001_access_rbac", "202611120002_director_answers"];
    const versions = ["202610030001", "202611120001"];
    expect(mod.report(names, versions).missing).toEqual(["202611120002_director_answers"]);
    expect(mod.report(names, versions).recorded).toEqual(["202610030001_director", "202611120001_access_rbac"]);
  });

  it("ledgerVersions accepts only an array of strings", async () => {
    const mod = (await import("@/scripts/migrate-doctor.mjs")) as MigrateDoctor;
    expect(mod.ledgerVersions({ versions: ["202610030001"] })).toEqual(["202610030001"]);
    expect(mod.ledgerVersions({ versions: "nope" })).toBeNull();
    expect(mod.ledgerVersions(null)).toBeNull();
    expect(mod.ledgerVersions({ versions: [1, 2] })).toBeNull();
  });

  it("--dry-run exits 2 without touching the network and never prints a secret", () => {
    const script = fileURLToPath(new URL("../scripts/migrate-doctor.mjs", import.meta.url));
    let failure: { status?: number; stderr?: string } | undefined;
    try {
      execFileSync(process.execPath, [script, "--dry-run"], { encoding: "utf8", stdio: "pipe" });
    } catch (error) {
      failure = error as { status?: number; stderr?: string };
    }
    expect(failure?.status).toBe(2);
    const output = `${failure?.stderr ?? ""}`;
    expect(output).toContain("konfigurasi");
    expect(output).not.toContain("supabase.co");
    expect(output).not.toContain("eyJ");
  });
});
