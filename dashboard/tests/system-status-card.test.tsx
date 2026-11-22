import { scryptSync } from "node:crypto";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { SystemStatusCard } from "@/components/system-status-card";
import { MIGRATION_NAMES } from "@/lib/migration-names";

const today = "2026-10-24";
const salt = "00112233445566778899aabbccddeeff";
let instructions: Record<string, unknown>[];
let latest: Record<string, { report_date: string } | null>;
let storeStatus: number | null;
let rpcStatus: Record<string, number>;
let ledgerBody: unknown;
let listBroken: boolean;
let ledgerVersions: string[] | "missing" | "garbage";
let commands: string[];
let logged: MockInstance<typeof console.error>;
const BODY_MARKER = "marker-db-body-9c41";
const versionOf = (name: string) => name.slice(0, 12);
const LEDGER_RPC = "melinda_schema_status";
const OPERATIONAL_RPCS = ["melinda_director_instructions", "melinda_daily_documents", "melinda_director_tasks"];
const failOperational = (status: number) => { for (const rpc of OPERATIONAL_RPCS) rpcStatus[rpc] = status; };
const loggedCodes = () => logged.mock.calls.map((call) => (JSON.parse(String(call[0])) as { code: string }).code).sort();
const allVersions = () => MIGRATION_NAMES.map(versionOf);
const without = (...names: string[]) => allVersions().filter((version) => !names.some((name) => versionOf(name) === version));

beforeEach(() => {
  instructions = []; storeStatus = null; rpcStatus = {}; ledgerBody = undefined; listBroken = false; ledgerVersions = allVersions(); commands = [];
  latest = { simrs_snapshot: { report_date: today } };
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-24T03:30:00Z")); // 10:30 WIB
  vi.stubEnv("MELINDAOS_DIRECTOR_STORE", "supabase");
  vi.stubEnv("MELINDAOS_APP_ORIGIN", "https://synthetic.example");
  vi.stubEnv("MELINDAOS_SUPABASE_URL", "https://synthetic.supabase.co");
  vi.stubEnv("MELINDAOS_SUPABASE_SECRET_KEY", "sb_secret_synthetic");
  vi.stubEnv("MELINDAOS_REVIEWER_PASSCODE_HASH", `scrypt$${salt}$${scryptSync("synthetic-test-passcode", salt, 64).toString("hex")}`);
  vi.stubEnv("MELINDAOS_REVIEWER_ID", "director-test");
  vi.stubEnv("MELINDAOS_MEDIFY_PUBLISHER_TOKEN_HASH", "a".repeat(64));
  logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    const status = storeStatus ?? rpcStatus[url.slice(url.lastIndexOf("/") + 1)] ?? null;
    if (status !== null) return new Response(BODY_MARKER, { status });
    const { command, args } = JSON.parse(init.body as string) as { command: string; args: Record<string, string> };
    commands.push(command);
    if (url.endsWith(`/${LEDGER_RPC}`)) {
      if (ledgerBody !== undefined) return Response.json(ledgerBody);
      if (ledgerVersions === "missing") return new Response(BODY_MARKER, { status: 404 });
      if (ledgerVersions === "garbage") return Response.json({ versions: "nope" });
      return command === "ledger" ? Response.json({ versions: ledgerVersions }) : Response.json({ errorCode: "invalid_command" });
    }
    if (command === "open" && listBroken) return Response.json({ errorCode: "invalid_command" });
    if (command === "open") return Response.json({ instructions: instructions.map((row) => ({ pic: [], ...row })) });
    // SATUSEHAT arrived today in every case here; its own alert is covered in ops-alerts.test.ts.
    if (command === "latest" && args.kind === "satusehat_snapshot") return Response.json({ document: { id: "s", kind: args.kind, producer: "vercel-cron-satusehat", payload_hash: "0".repeat(64), report_date: today, received_at: "2026-10-24T00:00:00Z" } });
    if (command === "latest") return Response.json({ document: latest[args.kind] ? { id: "x", kind: args.kind, producer: "biznet-medify", payload_hash: "0".repeat(64), received_at: "2026-10-24T00:00:00Z", ...latest[args.kind] } : null });
    return Response.json({ errorCode: "invalid_command" });
  });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const render = async (date = today) => renderToStaticMarkup(await SystemStatusCard({ date }));

describe("system status card", () => {
  it("renders nothing when today's checks find no problem, and spends no rate limit", async () => {
    expect(await render()).toBe("");
    expect(commands).toContain("open");
    expect(commands).not.toContain("rate_limit");
  });
  it("says when the Medify receiver is not configured, even when nothing else is wrong", async () => {
    vi.stubEnv("MELINDAOS_MEDIFY_PUBLISHER_TOKEN_HASH", "not-a-valid-hash");
    const html = await render();
    expect(html).toContain("Penerima data Medify belum dikonfigurasi.");
    expect(html).not.toContain("hal perlu diperiksa");
  });
  it("lists every finding in plain text", async () => {
    instructions = [{ id: "IOC-0001", reportDate: today, itemTitle: "Kalibrasi", action: "request_update", deadline: "2026-10-24T09:00", status: "diteruskan", createdAt: "2026-10-24T02:00:00Z" }];
    latest = { simrs_snapshot: { report_date: "2026-10-23" } };
    const html = await render();
    expect(html).toContain('role="status"');
    expect(html).toContain("Status sistem: 2 hal perlu diperiksa.");
    expect(html).toContain("IOC-0001 (Kalibrasi) melewati tenggat 24-10-2026 09.00 WIB, status diteruskan.");
    expect(html).toContain("Belum ada tarikan Medify untuk 2026-10-24");
  });
  it("names the cause when the database rejects the key", async () => {
    storeStatus = 401;
    const html = await render();
    expect(html).toContain("Kunci database ditolak. Periksa kunci Supabase di pengaturan Vercel.");
    expect(html).not.toContain("Fungsi database belum terpasang");
    expect(html).not.toContain("Database tidak dapat dihubungi");
    expect(html).not.toContain("Status sistem tidak dapat diperiksa saat ini.");
    expect(html).not.toContain("Pemeriksa pembaruan database");
    expect(html).not.toContain("<li>");
    expect(loggedCodes()).toEqual(["system_status_ledger", "system_status_unauthorized"]);
  });
  it("names the cause when a database function is missing, and says the checker is not installed", async () => {
    storeStatus = 404;
    const html = await render();
    expect(html).toContain("Fungsi database belum terpasang. Jalankan pembaruan database yang belum dijalankan.");
    expect(html).not.toContain("Kunci database ditolak");
    expect(html).not.toContain("Database tidak dapat dihubungi");
    expect(html.indexOf("Fungsi database belum terpasang")).toBeLessThan(html.indexOf("Pemeriksa pembaruan database belum terpasang."));
    expect(html).toContain("Pemeriksa pembaruan database belum terpasang. Jalankan <code>202611110004_schema_status</code> di SQL Editor Supabase.");
    expect(html).not.toContain("belum dijalankan, urut dari atas");
    expect(loggedCodes()).toEqual(["system_status_ledger", "system_status_missing_function"]);
  });
  it("names the cause when the database cannot be reached, and logs the operational and the ledger failure once each", async () => {
    storeStatus = 503;
    const html = await render();
    expect(html).toContain("Database tidak dapat dihubungi. Coba lagi beberapa saat.");
    expect(html).not.toContain("Kunci database ditolak");
    expect(html).not.toContain("Fungsi database belum terpasang");
    expect(html).not.toContain("Status sistem tidak dapat diperiksa saat ini.");
    expect(html).not.toContain("Pemeriksa pembaruan database");
    expect(html).not.toContain("<li>");
    expect(loggedCodes()).toEqual(["system_status_ledger", "system_status_unreachable"]);
  });
  it("keeps the general sentence when the failure has no known cause", async () => {
    listBroken = true;
    const html = await render();
    expect(html).toContain("Status sistem tidak dapat diperiksa saat ini.");
    expect(html).not.toContain("Kunci database ditolak");
    expect(html).not.toContain("Fungsi database belum terpasang");
    expect(html).not.toContain("Database tidak dapat dihubungi");
    expect(loggedCodes()).toEqual(["system_status_unknown"]);
  });
  it("keeps the general sentence, and does not suggest retrying, when the database rejects the request", async () => {
    storeStatus = 400;
    const html = await render();
    expect(html).toContain("Status sistem tidak dapat diperiksa saat ini.");
    expect(html).not.toContain("Kunci database ditolak");
    expect(html).not.toContain("Fungsi database belum terpasang");
    expect(html).not.toContain("Database tidak dapat dihubungi");
    expect(loggedCodes()).toEqual(["system_status_ledger", "system_status_unknown"]);
  });
  it("lists the migrations that are not applied, in order, and no operational line", async () => {
    const [first, second] = [MIGRATION_NAMES[3], MIGRATION_NAMES[5]];
    ledgerVersions = without(first, second);
    const html = await render();
    expect(html).toContain('role="status"');
    expect(html).toContain("2 pembaruan database belum dijalankan, urut dari atas:");
    expect(html).toContain(`<li><code>${first}</code></li><li><code>${second}</code></li>`);
    expect(html).not.toContain("hal perlu diperiksa");
    expect(html).not.toContain("Pemeriksa pembaruan database");
  });
  it("shows missing migrations together with an operational finding", async () => {
    ledgerVersions = without(MIGRATION_NAMES[7]);
    latest = { simrs_snapshot: { report_date: "2026-10-23" } };
    const html = await render();
    expect(html).toContain("1 pembaruan database belum dijalankan, urut dari atas:");
    expect(html).toContain(`<code>${MIGRATION_NAMES[7]}</code>`);
    expect(html).toContain("Status sistem: 1 hal perlu diperiksa.");
    expect(html).toContain("Belum ada tarikan Medify untuk 2026-10-24");
    expect(html.indexOf("belum dijalankan")).toBeLessThan(html.indexOf("Status sistem: 1 hal"));
  });
  it("shows the general sentence and the missing migrations when only the operational checks fail", async () => {
    listBroken = true;
    ledgerVersions = without(MIGRATION_NAMES[2]);
    const html = await render();
    expect(html).toContain("Status sistem tidak dapat diperiksa saat ini.");
    expect(html).toContain("1 pembaruan database belum dijalankan, urut dari atas:");
    expect(html).toContain(`<code>${MIGRATION_NAMES[2]}</code>`);
  });
  it("shows the cause and the missing migrations when the operational checks fail with a known cause", async () => {
    vi.stubGlobal("fetch", async (url: string) => url.endsWith("/melinda_schema_status") ? Response.json({ versions: without(MIGRATION_NAMES[4]) }) : new Response(BODY_MARKER, { status: 503 }));
    const html = await render();
    expect(html).toContain("Database tidak dapat dihubungi. Coba lagi beberapa saat.");
    expect(html).toContain("1 pembaruan database belum dijalankan, urut dari atas:");
    expect(html).toContain(`<code>${MIGRATION_NAMES[4]}</code>`);
    expect(html.indexOf("Database tidak dapat dihubungi")).toBeLessThan(html.indexOf("belum dijalankan"));
  });
  it("says the checker is not installed when its function is missing, without a migration list", async () => {
    ledgerVersions = "missing";
    const html = await render();
    expect(html).toContain("Pemeriksa pembaruan database belum terpasang. Jalankan <code>202611110004_schema_status</code> di SQL Editor Supabase.");
    expect(html).not.toContain("belum dijalankan, urut dari atas");
    expect(html).not.toContain("<li>");
  });
  it("logs and stays silent when the ledger answer is not a list of versions", async () => {
    ledgerVersions = "garbage";
    expect(await render()).toBe("");
    expect(loggedCodes()).toEqual(["system_status_ledger"]);
  });
  it("logs and stays silent when the ledger answers with an error code", async () => {
    const answer = globalThis.fetch;
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => url.endsWith("/melinda_schema_status") ? Response.json({ errorCode: "invalid_command" }) : answer(url, init));
    expect(await render()).toBe("");
    expect(loggedCodes()).toEqual(["system_status_ledger"]);
  });
  it.each([
    ["an object without versions", {}],
    ["a version list with a non-string entry", { versions: ["202610030001", 7] }],
  ])("logs the ledger failure once and stays silent when the ledger answers %s", async (_label, body) => {
    ledgerBody = body;
    expect(await render()).toBe("");
    expect(loggedCodes()).toEqual(["system_status_ledger"]);
  });
  it.each([
    ["an unreadable answer", () => { ledgerVersions = "garbage"; }],
    ["HTTP 401 on the ledger RPC only", () => { rpcStatus[LEDGER_RPC] = 401; }],
  ])("still shows an operational finding when the ledger read fails with %s", async (_label, breakLedger) => {
    breakLedger();
    latest = { simrs_snapshot: { report_date: "2026-10-23" } };
    const html = await render();
    expect(html).toContain("Status sistem: 1 hal perlu diperiksa.");
    expect(html).toContain("Belum ada tarikan Medify untuk 2026-10-24");
    expect(html).not.toContain("belum dijalankan");
    expect(loggedCodes()).toEqual(["system_status_ledger"]);
  });
  it("shows one cause sentence and no installer line when the ledger is refused and the database is unreachable", async () => {
    rpcStatus[LEDGER_RPC] = 401;
    failOperational(503);
    const html = await render();
    expect(html).toContain("Database tidak dapat dihubungi. Coba lagi beberapa saat.");
    expect(html).not.toContain("belum terpasang");
    expect(html).not.toContain("Kunci database ditolak");
    expect(html.match(/<p>/g)).toHaveLength(1);
    expect(loggedCodes()).toEqual(["system_status_ledger", "system_status_unreachable"]);
  });
  it("shows the rejected-key sentence and the installer line when the ledger function is missing and the key is refused", async () => {
    rpcStatus[LEDGER_RPC] = 404;
    failOperational(401);
    const html = await render();
    expect(html).toContain("Kunci database ditolak. Periksa kunci Supabase di pengaturan Vercel.");
    expect(html).toContain("Pemeriksa pembaruan database belum terpasang. Jalankan <code>202611110004_schema_status</code> di SQL Editor Supabase.");
    expect(html.match(/<p>/g)).toHaveLength(2);
    expect(loggedCodes()).toEqual(["system_status_ledger", "system_status_unauthorized"]);
  });
  it("counts and names every migration when the ledger is empty", async () => {
    ledgerVersions = [];
    const html = await render();
    expect(html).toContain(`${MIGRATION_NAMES.length} pembaruan database belum dijalankan, urut dari atas:`);
    expect(html).toContain(`<li><code>${MIGRATION_NAMES[0]}</code></li>`);
    expect(html).toContain(`<li><code>${MIGRATION_NAMES[MIGRATION_NAMES.length - 1]}</code></li>`);
    expect(html.match(/<li>/g)).toHaveLength(MIGRATION_NAMES.length);
  });
  it("shows the general sentence without throwing when the storage URL is not configured in protected mode", async () => {
    vi.stubEnv("MELINDAOS_SUPABASE_URL", undefined);
    const html = await render();
    expect(html).toContain("Status sistem tidak dapat diperiksa saat ini.");
    expect(loggedCodes()).toEqual(["system_status_ledger", "system_status_unknown"]);
  });
  it("never logs the body of a failed response", async () => {
    storeStatus = 503;
    await render();
    storeStatus = null;
    ledgerVersions = "missing";
    await render();
    expect(logged).toHaveBeenCalled();
    expect(logged.mock.calls.map((call) => String(call[0])).join("\n")).not.toContain(BODY_MARKER);
  });
  it("renders nothing for a date other than today, without reading the store", async () => {
    expect(await render("2026-10-23")).toBe("");
    expect(commands).toEqual([]);
    expect(commands).not.toContain("ledger");
  });
  it("renders nothing in file mode, without reading the store", async () => {
    vi.stubEnv("MELINDAOS_DIRECTOR_STORE", "file");
    vi.stubEnv("NODE_ENV", "test");
    expect(await render()).toBe("");
    expect(commands).toEqual([]);
  });
});
