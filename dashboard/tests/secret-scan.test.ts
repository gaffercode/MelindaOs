import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The scanner runs for real against a throwaway Git repository. Every "secret" below is assembled from pieces at
// run time, so this file holds no token-shaped text itself.
const script = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "tools", "secret-scan.mjs");
const gitEnv = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_"))) as NodeJS.ProcessEnv;
const git = (cwd: string, ...args: string[]) => spawnSync("git", args, { cwd, env: gitEnv, encoding: "utf8" });
const gitInstalled = git(tmpdir(), "--version").status === 0;

const privateKey = ["-----BEGIN", "PRIVATE KEY-----"].join(" ");
const githubToken = "ghp_" + "a1B2".repeat(9);
const databaseUrl = (password: string) => ["postgres", "://", "app", ":", password, "@", "db.internal:5432/app"].join("");

function scan(files: Record<string, string>, { stage = Object.keys(files), mode = ["--staged"] } = {}) {
  const repo = mkdtempSync(join(tmpdir(), "secret-scan-"));
  try {
    git(repo, "init", "--quiet");
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(dirname(join(repo, path)), { recursive: true });
      writeFileSync(join(repo, path), text);
    }
    if (stage.length > 0) git(repo, "add", "--force", "--", ...stage);
    const run = spawnSync(process.execPath, [script, "--root", repo, ...mode], { env: gitEnv, encoding: "utf8" });
    return { status: run.status, output: run.stdout + run.stderr };
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
}

describe.skipIf(!gitInstalled)("secret-scan", () => {
  it("passes a clean staged change", () => {
    const result = scan({ "src/app.mjs": "export const greeting = 'halo';\n", ".env.example": "API_KEY=\nDATABASE_URL=\n" });
    expect(result.status, result.output).toBe(0);
  });

  it("refuses a staged token or private key and never echoes it", () => {
    const result = scan({ "notes.md": `first line\n${privateKey}\n`, "src/client.mjs": `const token = "${githubToken}";\n` });
    expect(result.status, result.output).toBe(1);
    expect(result.output).toMatch(/notes\.md:2 {2}private key block/);
    expect(result.output).toMatch(/src\/client\.mjs:1 {2}GitHub token/);
    expect(result.output).not.toContain(githubToken);
  });

  it("refuses local env files, key files and database files by name", () => {
    const result = scan({ ".env.local": "PORT=3000\n", "deploy/server.pem": "x\n", "data/local.sqlite": "x\n" });
    expect(result.status, result.output).toBe(1);
    for (const path of [".env.local", "deploy/server.pem", "data/local.sqlite"]) expect(result.output).toContain(`${path}  forbidden file`);
  });

  it("fails a database URL with a real-looking password and passes a placeholder", () => {
    expect(scan({ "docs/setup.md": `${databaseUrl("Zk7pQ2mW9x")}\n` }).status).toBe(1);
    expect(scan({ "docs/setup.md": `${databaseUrl("postgres")}\n${databaseUrl("<password>")}\n` }).status).toBe(0);
  });

  it("fails a filled secret in a config file; an empty one, a hash and a marked example pass", () => {
    const value = "q7Rk2ZtM9vB4xL1nP8sD5wH3";
    expect(scan({ "deploy/app.env": `SERVICE_API_KEY=${value}\n` }).status).toBe(1);
    const harmless = `SERVICE_API_KEY=\nSERVICE_TOKEN_HASH=${value}\nSERVICE_API_KEY=${value} # secret-scan:allow\n`;
    expect(scan({ "deploy/app.env": harmless }).status).toBe(0);
  });

  it("reads only the index with --staged and every tracked file without it", () => {
    const files = { "a.md": "fine\n", "b.md": `${privateKey}\n` };
    expect(scan(files, { stage: ["a.md"] }).status).toBe(0);
    expect(scan(files, { mode: [] }).status).toBe(1);
  });

  it("stops with exit code 2 outside a Git working tree", () => {
    const folder = mkdtempSync(join(tmpdir(), "secret-scan-nogit-"));
    try {
      const run = spawnSync(process.execPath, [script, "--root", folder], {
        env: { ...gitEnv, GIT_CEILING_DIRECTORIES: dirname(folder) },
        encoding: "utf8",
      });
      expect(run.status, run.stdout + run.stderr).toBe(2);
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  });
});
