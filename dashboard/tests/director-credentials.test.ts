import { spawnSync } from "node:child_process";
import { scryptSync } from "node:crypto";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const script = fileURLToPath(new URL("../scripts/hash-director-credentials.mjs", import.meta.url));
const passcode = "synthetic director passphrase";

function provision(passcodeInput = passcode, args: string[] = []) {
  return spawnSync(process.execPath, [script, ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      MELINDAOS_PROVISION_PASSCODE: passcodeInput,
    },
    timeout: 5_000,
  });
}

describe("director credential provisioning CLI", () => {
  it.each([
    { name: "ordinary synthetic credentials", passcodeInput: passcode },
    { name: "minimum supported lengths", passcodeInput: "p".repeat(16) },
    { name: "maximum authentication-compatible lengths", passcodeInput: "p".repeat(256) },
    { name: "a passphrase whose boundary spaces are significant", passcodeInput: `  ${passcode}  ` },
  ])("produces an authentication-compatible hash for $name", ({ passcodeInput }) => {
    const result = provision(passcodeInput);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    const lines = result.stdout.trimEnd().split("\n");
    expect(lines).toHaveLength(1);
    const passcodeLine = lines.find((line) => line.startsWith("MELINDAOS_REVIEWER_PASSCODE_HASH="));
    expect(passcodeLine).toMatch(/^MELINDAOS_REVIEWER_PASSCODE_HASH=scrypt\$[a-f0-9]{32,128}\$[a-f0-9]{128}$/);
    const [, salt, digest] = (passcodeLine ?? "").split("$");
    expect(digest).toBe(scryptSync(passcodeInput, salt, 64).toString("hex"));
    expect(result.stdout).not.toContain(passcodeInput);
  });

  it("uses a new random salt when the same credentials are provisioned again", () => {
    const first = provision();
    const second = provision();
    expect(first.status).toBe(0);
    expect(second.status).toBe(0);
    const passcodeHash = (output: string) => output.split("\n").find((line) => line.startsWith("MELINDAOS_REVIEWER_PASSCODE_HASH="));
    expect(passcodeHash(first.stdout)).toBeDefined();
    expect(passcodeHash(first.stdout)).not.toBe(passcodeHash(second.stdout));
  });

  it.each([
    { name: "missing passcode", passcodeInput: "" },
    { name: "short passcode", passcodeInput: "short-passcode" },
    { name: "oversized passcode", passcodeInput: "p".repeat(257) },
    { name: "blank passcode", passcodeInput: " ".repeat(16) },
    { name: "passcode control characters", passcodeInput: `${passcode}\n` },
  ])("rejects $name without printing credentials or hashes", ({ passcodeInput }) => {
    const result = provision(passcodeInput);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr.trim()).not.toBe("");
    expect(result.stderr).not.toMatch(/Error:|\bat \S|node:|scrypt\$/);
    if (passcodeInput.trim()) expect(result.stderr).not.toContain(passcodeInput);
  });

  it("rejects credential arguments without reflecting them in errors", () => {
    const argument = "synthetic-command-argument-secret";
    const result = provision(passcode, [argument]);
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr.trim()).not.toBe("");
    for (const secret of [argument, passcode]) expect(result.stderr).not.toContain(secret);
    expect(result.stderr).not.toMatch(/Error:|\bat \S|node:/);
  });
});
