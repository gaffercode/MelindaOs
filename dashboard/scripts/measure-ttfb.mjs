// Cold vs warm start probe: three sequential rounds over a few routes, time to response headers.
// Protected routes are requested unauthenticated, so they stop at the login redirect.
// Usage: node scripts/measure-ttfb.mjs https://melindaos.app
const PATHS = ["/api/health", "/director-login", "/", "/starkes", "/studio"];
const ROUNDS = 3;

const base = process.argv[2];
if (!base) {
  console.error("Usage: node scripts/measure-ttfb.mjs <baseUrl>");
  process.exit(2);
}

console.log(`base ${base}  at ${new Date().toISOString()}`);
console.log(["path", ...Array.from({ length: ROUNDS }, (_, i) => `round ${i + 1}`)].join("\t"));
for (const path of PATHS) {
  const cells = [path];
  for (let round = 0; round < ROUNDS; round += 1) {
    const started = performance.now();
    try {
      const response = await fetch(new URL(path, base), { redirect: "manual", cache: "no-store" });
      const ms = Math.round(performance.now() - started);
      await response.body?.cancel();
      cells.push(`${response.status} ${ms} ms`);
    } catch (error) {
      cells.push(`error ${error instanceof Error ? error.name : "unknown"}`);
    }
  }
  console.log(cells.join("\t"));
}
