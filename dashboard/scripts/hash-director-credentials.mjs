import { randomBytes, scryptSync } from "node:crypto";

try {
  const passcode = process.env.MELINDAOS_PROVISION_PASSCODE ?? "";
  if (
    process.argv.length !== 2 ||
    passcode.length < 16 || passcode.length > 256 || !passcode.trim() ||
    /[\u0000-\u001f\u007f-\u009f]/.test(passcode)
  ) {
    throw new Error("invalid");
  }
  const salt = randomBytes(32).toString("hex");
  const passcodeHash = `scrypt$${salt}$${scryptSync(passcode, salt, 64).toString("hex")}`;
  process.stdout.write(`MELINDAOS_REVIEWER_PASSCODE_HASH=${passcodeHash}\n`);
} catch {
  process.stderr.write("Credential provisioning failed. Use valid temporary environment variables and no arguments.\n");
  process.exitCode = 1;
}
