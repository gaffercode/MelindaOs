#!/usr/bin/env node
/**
 * Lifecycle stages for the SAFRS standalone contract (project.contract.json), run from the capsule root:
 *   node tools/capsule.mjs install|lint|typecheck|test|build|run|deploy-dry-run
 * Python uses uv with uv.lock; the dashboard uses npm with dashboard/package-lock.json.
 * Commands go through the shell on Windows, where npm is a .cmd file.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const DASHBOARD = path.join(ROOT, "dashboard");
const BUILD_LOG = path.join(DASHBOARD, ".next", "capsule-build.log");
const RUN_PORT = "4347";

function run(cwd, program, args, capture = false) {
  const result = spawnSync(program, args, {
    cwd,
    stdio: capture ? ["inherit", "pipe", "pipe"] : "inherit",
    shell: process.platform === "win32",
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (capture) {
    process.stdout.write(result.stdout ?? "");
    process.stderr.write(result.stderr ?? "");
  }
  if (result.status !== 0) {
    console.error(`FAIL ${program} ${args.join(" ")} (exit ${result.status ?? result.signal})`);
    process.exit(result.status || 1);
  }
  return result;
}

const python = (...args) => run(ROOT, "uv", ["run", "--locked", ...args]);
const npm = (...args) => run(DASHBOARD, "npm", args);

const stages = {
  install() {
    run(ROOT, "uv", ["sync", "--locked", "--extra", "dev"]);
    npm("ci");
  },
  lint: () => npm("run", "lint"),
  typecheck: () => npm("run", "typecheck"),
  test() {
    python("pytest", "-q");
    for (const check of ["validate_package.py", "validate_frontmatter.py", "check_validation_snapshot.py", "check_migration_rls.py"]) {
      python("python", "-X", "utf8", `tools/governance/${check}`);
    }
    npm("run", "test:coverage");
  },
  build() {
    const result = run(DASHBOARD, "npm", ["run", "build"], true);
    // deploy-dry-run feeds this log to the trace-budget guard, the same check CI runs after the build.
    writeFileSync(BUILD_LOG, `${result.stdout ?? ""}${result.stderr ?? ""}`);
  },
  run: () => npm("run", "start", "--", "--port", RUN_PORT),
  "deploy-dry-run"() {
    for (const file of [path.join(DASHBOARD, ".next", "BUILD_ID"), BUILD_LOG]) {
      if (!existsSync(file)) {
        console.error(`FAIL missing deploy input ${path.relative(ROOT, file)}; run the build stage first.`);
        process.exit(1);
      }
    }
    run(DASHBOARD, "node", ["scripts/trace-budget.mjs", "--build-log", ".next/capsule-build.log"]);
    const pkg = JSON.parse(readFileSync(path.join(DASHBOARD, "package.json"), "utf8"));
    const local = Object.entries({ ...pkg.dependencies, ...pkg.devDependencies }).filter(([, version]) => /^(workspace|file|link|portal):/.test(version));
    if (local.length) {
      console.error(`FAIL non-registry dependencies: ${local.map(([name]) => name).join(", ")}`);
      process.exit(1);
    }
    console.log(JSON.stringify({
      status: "PASS",
      buildId: readFileSync(path.join(DASHBOARD, ".next", "BUILD_ID"), "utf8").trim(),
      deployment: "Vercel project with Root Directory dashboard; files outside it are included in the build",
      sideEffects: "none: no network, credentials, deployment or remote writes",
    }, null, 2));
  },
};

const stage = stages[process.argv[2]];
if (!stage || process.argv.length !== 3) {
  console.error(`Usage: node tools/capsule.mjs ${Object.keys(stages).join("|")}`);
  process.exit(2);
}
stage();
