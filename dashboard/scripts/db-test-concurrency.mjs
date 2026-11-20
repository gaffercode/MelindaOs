import { spawn } from "node:child_process";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || /(?:prod|production)/i.test(databaseUrl)) {
  throw new Error("DATABASE_URL must name an explicit disposable QA database.");
}
const psql = process.env.PSQL || "psql";

function query(sql) {
  return new Promise((resolve, reject) => {
    const child = spawn(psql, ["--no-psqlrc", "--set=ON_ERROR_STOP=1", "-At", "-c", sql, databaseUrl], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve(stdout.trim()) : reject(new Error(`psql exited ${code}: ${stderr.trim()}`)));
  });
}

const phase = `concurrency_${Date.now().toString(36)}`;
const hash = "9".repeat(64);
const scheduled = JSON.parse(await query(`select public.melinda_daily_pipeline('schedule', jsonb_build_object('reportDate','2099-12-01','phase','${phase}','semanticHash','${hash}'));`));
const sql = (owner) => `select public.melinda_daily_pipeline('claim', jsonb_build_object('runId','${scheduled.runId}','owner','${owner}','now','2099-12-01T00:00:00Z','leaseSeconds',180));`;
const [left, right] = await Promise.all([query(sql("worker-a")), query(sql("worker-b"))]);
const claims = [JSON.parse(left), JSON.parse(right)];
if (claims.filter((claim) => claim.claimed === true).length !== 1 || claims.filter((claim) => claim.claimed === false).length !== 1) {
  throw new Error(`expected one fenced owner, received ${JSON.stringify(claims)}`);
}
process.stdout.write(`PASS two-connection lease fencing (${claims.find((claim) => claim.claimed)?.runId})\n`);
