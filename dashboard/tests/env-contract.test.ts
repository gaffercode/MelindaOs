import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The env templates and the ignore rules are the two things that keep secrets and real data out of Git.
// These tests read this capsule's own files only: nothing here depends on an enclosing repository.

const dashboard = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const root = join(dashboard, "..");

const AREAS = [
  { name: "dashboard", dir: dashboard, template: join(dashboard, ".env.example") },
  { name: "runtime", dir: join(root, "runtime"), template: join(root, "runtime", ".env.example") },
];

const SKIPPED_DIRS = new Set([
  "node_modules", ".next", ".vercel", "coverage", "tests", ".venv", "__pycache__", ".pytest_cache",
  "public", "data", "assets", "work",
]);
const JS_FILE = new Set([".ts", ".tsx", ".mjs", ".js", ".cjs"]);
const JS_READS = [
  /process\.env\.([A-Z][A-Z0-9_]+)/g,
  /process\.env\[\s*["']([A-Z][A-Z0-9_]+)["']\s*\]/g,
  /\benv\.([A-Z][A-Z0-9_]+)/g,
];
const PY_READS = [
  /os\.getenv\(\s*["']([A-Z][A-Z0-9_]+)["']/g,
  /os\.environ\.get\(\s*["']([A-Z][A-Z0-9_]+)["']/g,
  /os\.environ\[\s*["']([A-Z][A-Z0-9_]+)["']\s*\]/g,
];

// Set by the platform or the shell, never by an env file.
const PLATFORM = /^(?:NODE_ENV|CI|PORT|TZ|HOME|PATH|TEMP|TMP|TMPDIR|VERCEL(?:_[A-Z0-9_]+)?|NEXT_RUNTIME|NEXT_PHASE)$/;

// Given on the command line for one command and never stored in an env file.
const COMMAND_LINE_ONLY = new Map([
  ["DATABASE_URL", "names the disposable database for scripts/db-test.sh"],
  ["PSQL", "optional path to the psql binary for scripts/db-test-concurrency.mjs"],
  ["MELINDAOS_PROVISION_PASSCODE", "typed once for scripts/hash-director-credentials.mjs; only its hash is kept"],
]);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) return SKIPPED_DIRS.has(entry.name) ? [] : sourceFiles(join(dir, entry.name));
    const extension = extname(entry.name);
    if (/\.(?:test|spec)\./.test(entry.name)) return [];
    return JS_FILE.has(extension) || extension === ".py" ? [join(dir, entry.name)] : [];
  });
}

function variablesRead(dir: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const file of sourceFiles(dir)) {
    const text = readFileSync(file, "utf8");
    for (const pattern of extname(file) === ".py" ? PY_READS : JS_READS) {
      for (const match of text.matchAll(pattern)) if (!found.has(match[1])) found.set(match[1], file.slice(root.length + 1));
    }
  }
  return found;
}

function templateEntries(file: string): Map<string, string> {
  const entries = new Map<string, string>();
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = /^#?\s*([A-Z][A-Z0-9_]+)=(.*)$/.exec(line);
    if (match) entries.set(match[1], match[2].trim());
  }
  return entries;
}

const gitEnv = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_"))) as NodeJS.ProcessEnv;

/** Judges this capsule's ignore files alone, in an empty temporary repository. */
function ignoredByThisCapsule(paths: string[]): string[] {
  const sandbox = mkdtempSync(join(tmpdir(), "capsule-ignore-"));
  try {
    spawnSync("git", ["init", "--quiet"], { cwd: sandbox, env: gitEnv });
    for (const file of [".gitignore", "dashboard/.gitignore", "runtime/.gitignore"]) {
      mkdirSync(dirname(join(sandbox, file)), { recursive: true });
      copyFileSync(join(root, file), join(sandbox, file));
    }
    return paths.filter(
      (path) =>
        spawnSync("git", ["-c", "core.excludesFile=", "check-ignore", "--quiet", "--no-index", path], {
          cwd: sandbox,
          env: gitEnv,
        }).status === 0,
    );
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
}

describe("env templates", () => {
  it.each(AREAS)("$name/.env.example names every variable its code reads", ({ dir, template }) => {
    const listed = templateEntries(template);
    const missing = [...variablesRead(dir)]
      .filter(([name]) => !PLATFORM.test(name) && !COMMAND_LINE_ONLY.has(name) && !listed.has(name))
      .map(([name, file]) => `${name} (read in ${file})`)
      .sort();
    expect(missing).toEqual([]);
  });

  it.each(AREAS)("$name/.env.example holds no value for keys, tokens, secrets or passwords", ({ template }) => {
    const filled = [...templateEntries(template)]
      .filter(([name, value]) => /KEY|TOKEN|SECRET|PASSWORD|PASSCODE/.test(name) && !/_(?:FILE|ID)$/.test(name) && value !== "")
      .map(([name]) => name);
    expect(filled).toEqual([]);
  });

  it("keeps command-line-only variables out of both templates", () => {
    const stored = AREAS.flatMap(({ template }) => [...templateEntries(template).keys()]).filter((name) => COMMAND_LINE_ONLY.has(name));
    expect(stored).toEqual([]);
  });
});

describe("ignore rules", () => {
  const gitInstalled = spawnSync("git", ["--version"], { env: gitEnv }).status === 0;

  it.skipIf(!gitInstalled)("keep local env files, databases, dumps, backups and keys out of Git", () => {
    const mustBeIgnored = [
      ".env", ".env.local", ".env.production", ".env.development.local",
      "dashboard/.env.local", "runtime/.env", "runtime/.env.local",
      "local.sqlite", "local.sqlite3", "dashboard/local.db",
      "dump.sql", "prod-backup.sql", "melinda.dump", "melinda.pgdump", "melinda.sql.gz", "notes.bak", "backups/2026.tar", "dumps/a.sql",
      "server.pem", "private.key", "client.p12", "id_rsa", "id_ed25519", "service-account.json", "credentials.json",
      ".vercel/project.json", "dashboard/.vercel/project.json", "dashboard/supabase/.temp/project-ref",
    ];
    const ignored = new Set(ignoredByThisCapsule(mustBeIgnored));
    expect(mustBeIgnored.filter((path) => !ignored.has(path))).toEqual([]);
  });

  it.skipIf(!gitInstalled)("still let the templates, migrations, tests and the dummy seed be committed", () => {
    const mustStayTrackable = [
      "dashboard/.env.example", "runtime/.env.example",
      "dashboard/supabase/migrations/202610030001_director.sql", "dashboard/supabase/tests/director.sql",
      "dashboard/supabase/storage/hrd-bucket.sql", "dashboard/supabase/seed.sql",
    ];
    expect(ignoredByThisCapsule(mustStayTrackable)).toEqual([]);
  });
});
