// Post-build guard for server function size: fails on Turbopack whole-project tracing warnings,
// on routes over their trace budget, and on runtime files missing from a route trace.
// Usage (from dashboard/, after `next build`): node scripts/trace-budget.mjs --build-log build.log
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const MIB = 1024 * 1024;
// default: the smallest whole MiB above the largest non-knowledge route (/api/starkes/kit, 5.25 MiB on 2026-11-08).
// At 9 MiB, data/knowledge-index.json (3.0 MiB) could leak into that route unnoticed (5.25 + 3.0 < 9); at 6 it fails.
export const BUDGETS = { default: 6 * MIB, knowledge: 16 * MIB, pdfjs: 10 * MIB };
export const KNOWLEDGE_ROUTES = ["/api/ask", "/api/melinda/chat", "/api/search", "/api/dashboard", "/api/health", "/api/mcp"];
// Routes that read PDFs with pdfjs-dist: the bundle carries pdf.mjs (1 MiB) and pdf.worker.mjs (2.3 MiB), which pdfjs
// imports at runtime and tracing cannot see.
export const PDFJS_ROUTES = ["/order-obat", "/api/director/order-obat/berkas", "/api/director/order-obat/berkas/[id]", "/api/director/order-obat/berkas/[id]/keputusan", "/api/director/order-obat/sumber"];
// Route → dashboard-relative files the route reads at runtime and must carry in its trace.
// The map lives in scripts/trace-manifest.json, the single source shared with next.config.ts.
const traceManifest = JSON.parse(readFileSync(new URL("./trace-manifest.json", import.meta.url), "utf8"));
export const REQUIRED_FILES = traceManifest.requires;

const DYNAMIC_WARNING = "Dynamic filesystem access";
const TRACE_SUFFIX = /\/(page|route)\.js\.nft\.json$/;

export function routeFromTracePath(tracePath) {
  const normalized = tracePath.split(sep).join("/");
  const marker = "server/app/";
  const start = normalized.indexOf(marker);
  const tail = start >= 0 ? normalized.slice(start + marker.length) : normalized;
  const route = ("/" + tail).replace(TRACE_SUFFIX, "");
  return route === "" ? "/" : route;
}

function traceFiles(dir) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...traceFiles(full));
    else if (entry.name === "page.js.nft.json" || entry.name === "route.js.nft.json") found.push(full);
  }
  return found;
}

export function readRouteTraces(dashboardDir) {
  const appDir = join(dashboardDir, ".next", "server", "app");
  return traceFiles(appDir).map((tracePath) => {
    const { files: entries } = JSON.parse(readFileSync(tracePath, "utf8"));
    let bytes = 0;
    const files = [];
    for (const entry of entries) {
      const absolute = resolve(dirname(tracePath), entry);
      files.push(relative(dashboardDir, absolute).split(sep).join("/"));
      if (existsSync(absolute)) {
        const stat = statSync(absolute);
        if (stat.isFile()) bytes += stat.size;
      }
    }
    return { route: routeFromTracePath(relative(dashboardDir, tracePath)), bytes, files };
  });
}

const mib = (bytes) => `${(bytes / MIB).toFixed(1)} MiB`;
const budgetFor = (route) => (KNOWLEDGE_ROUTES.includes(route) ? BUDGETS.knowledge : PDFJS_ROUTES.includes(route) ? BUDGETS.pdfjs : BUDGETS.default);

export function evaluateTraces({ routes, buildLog, required = REQUIRED_FILES }) {
  const failures = [];
  const warnings = buildLog.split(/\r?\n/).filter((line) => line.includes(DYNAMIC_WARNING));
  if (warnings.length > 0) failures.push(`${warnings.length} Turbopack "${DYNAMIC_WARNING}" warning(s) in the build log`);
  for (const { route, bytes } of routes) {
    const budget = budgetFor(route);
    if (bytes > budget) failures.push(`${route}: ${mib(bytes)} exceeds budget ${mib(budget)}`);
  }
  for (const [route, files] of Object.entries(required)) {
    const trace = routes.find((r) => r.route === route);
    if (!trace) {
      failures.push(`${route}: required route has no trace`);
      continue;
    }
    for (const file of files) if (!trace.files.includes(file)) failures.push(`${route}: missing required file ${file}`);
  }
  return failures;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const logIndex = process.argv.indexOf("--build-log");
  if (logIndex < 0 || !process.argv[logIndex + 1]) {
    console.error("Usage: node scripts/trace-budget.mjs --build-log <file>");
    process.exit(2);
  }
  const dashboardDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const routes = readRouteTraces(dashboardDir).sort((a, b) => b.bytes - a.bytes);
  for (const { route, bytes } of routes) console.log(`${route}  ${mib(bytes)}  ${mib(budgetFor(route))}`);
  const failures = evaluateTraces({ routes, buildLog: readFileSync(process.argv[logIndex + 1], "utf8") });
  for (const failure of failures) console.error(`FAIL ${failure}`);
  process.exit(failures.length > 0 ? 1 : 0);
}
