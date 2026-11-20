import { generateKeyPairSync, scryptSync } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as login } from "@/app/api/director/session/route";
import { POST as sync } from "@/app/api/starkes/drive-sync/route";
import { DRIVE_DENIED, resetDriveToken } from "@/lib/starkes/drive-source";

const origin = "https://synthetic.example";
const salt = "00112233445566778899aabbccddeeff";
const passcodeHash = `scrypt$${salt}$${scryptSync("synthetic-test-passcode", salt, 64).toString("hex")}`;
const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const account = { client_email: "sync@synthetic.iam.gserviceaccount.com", private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString() };
const folder = (id: string, name: string) => ({ id, name, mimeType: "application/vnd.google-apps.folder", modifiedTime: "" });
const pdf = (id: string, extra: Record<string, unknown> = {}) => ({ id, name: `${id}.pdf`, mimeType: "application/pdf", modifiedTime: "2026-11-01T00:00:00Z", webViewLink: `https://drive.google.com/${id}`, ...extra });

let session: { reviewerId: string } | null;
let googleStatus: number;
let evidenceCalls: { command: string; args: Record<string, unknown> }[];

beforeEach(() => {
  session = null; googleStatus = 200; evidenceCalls = [];
  resetDriveToken();
  vi.stubEnv("ANTHROPIC_API_KEY", "synthetic-anthropic-key");
  vi.stubEnv("MELINDAOS_DIRECTOR_STORE", "supabase");
  vi.stubEnv("MELINDAOS_APP_ORIGIN", origin);
  vi.stubEnv("MELINDAOS_SUPABASE_URL", "https://synthetic.supabase.co");
  vi.stubEnv("MELINDAOS_SUPABASE_SECRET_KEY", "sb_secret_synthetic");
  vi.stubEnv("MELINDAOS_REVIEWER_PASSCODE_HASH", passcodeHash);
  vi.stubEnv("MELINDAOS_REVIEWER_ID", "director-test");
  vi.stubEnv("MELINDAOS_GOOGLE_SA_JSON", Buffer.from(JSON.stringify(account)).toString("base64"));
  vi.stubEnv("MELINDAOS_STARKES_DRIVE_ROOT", "root-id");
  vi.stubGlobal("fetch", async (input: string, init: RequestInit) => {
    const url = String(input);
    if (url.startsWith("https://oauth2.googleapis.com/token")) return googleStatus === 200 ? Response.json({ access_token: "t" }) : new Response("", { status: googleStatus });
    if (url.startsWith("https://www.googleapis.com/drive/v3/files")) {
      const q = new URL(url).searchParams.get("q") ?? "";
      if (q.startsWith("'root-id'")) return Response.json({ files: [folder("skp", "15-SKP")] });
      if (q === "'skp' in parents") return Response.json({ files: [pdf("kept"), pdf("binned", { trashed: true })] });
      return Response.json({ files: [] });
    }
    if (url === "https://api.anthropic.com/v1/messages") return Response.json({ content: [{ type: "text", text: JSON.stringify({ epIds: ["47104-2024:SKP:1:2"], kind: "D", confidence: 0.7 }) }], stop_reason: "end_turn" });
    const { command, args } = JSON.parse(String(init.body)) as { command: string; args: Record<string, unknown> };
    if (url.endsWith("/melinda_starkes_evidence")) {
      evidenceCalls.push({ command, args });
      if (command === "list") return Response.json({ evidence: [] });
      if (command === "withdraw_missing") return Response.json({ withdrawn: args.chapter_code === "SKP" ? 1 : 0 });
      return Response.json({ ok: true });
    }
    if (command === "rate_limit") return Response.json({ allowed: true });
    if (command === "rate_reset") return Response.json({ ok: true });
    if (command === "session_create") { session = { reviewerId: "director-test" }; return Response.json({ ok: true }); }
    if (command === "session_read") return Response.json({ session });
    return Response.json({ errorCode: "invalid_command" });
  });
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

function request(headers: Record<string, string> = {}) {
  return new Request(`${origin}/api/starkes/drive-sync`, { method: "POST", headers: { "Content-Type": "application/json", Origin: origin, ...headers }, body: "{}" });
}
async function directorSession() {
  const response = await login(new Request(`${origin}/api/director/session`, { method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify({ passcode: "synthetic-test-passcode", returnTo: "/" }) }));
  const body = await response.json() as { csrfToken: string };
  return { Cookie: response.headers.get("set-cookie")!.split(";")[0], "X-CSRF-Token": body.csrfToken };
}

describe("POST /api/starkes/drive-sync", () => {
  it("requires a Director session and CSRF", async () => {
    expect((await sync(request())).status).toBe(401);
    const credentials = await directorSession();
    expect((await sync(request({ Cookie: credentials.Cookie }))).status).toBe(403);
  });

  it("withdraws a trashed file and stores the live one as pending", async () => {
    const response = await sync(request(await directorSession()));
    expect(await response.json()).toEqual({ scanned: 2, newPending: 1, withdrawn: 1, errors: [] });
    const skpWithdraw = evidenceCalls.find((c) => c.command === "withdraw_missing" && c.args.chapter_code === "SKP");
    expect(skpWithdraw?.args.present_refs).toEqual(["kept"]);
    const upsert = evidenceCalls.find((c) => c.command === "upsert_pending");
    expect(upsert?.args.rows).toMatchObject([{ ref: "kept", chapter_code: "SKP", ep_ids: ["47104-2024:SKP:1:2"], kind: "D" }]);
  });

  it("reports a revoked Google key without writing to the store", async () => {
    googleStatus = 401;
    const response = await sync(request(await directorSession()));
    expect(await response.json()).toEqual({ scanned: 0, newPending: 0, withdrawn: 0, errors: [DRIVE_DENIED] });
    expect(evidenceCalls).toEqual([]);
  });
});
