import { generateKeyPairSync } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DRIVE_DENIED, listChapterFiles, readMatchText, resetDriveToken } from "../lib/starkes/drive-source";

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const account = { client_email: "sync@synthetic.iam.gserviceaccount.com", private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString() };
const file = (id: string, name: string, extra: Record<string, unknown> = {}) => ({ id, name, mimeType: "application/pdf", modifiedTime: "2026-11-01T00:00:00Z", webViewLink: `https://drive.google.com/${id}`, ...extra });

let tokenStatus: number;
let urls: string[];
const fake: typeof fetch = async (input, init) => {
  const url = String(input);
  urls.push(url);
  if (url.startsWith("https://oauth2.googleapis.com/token")) {
    expect(String(init?.body)).toContain("grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer");
    return tokenStatus === 200 ? Response.json({ access_token: "synthetic-token" }) : new Response("denied", { status: tokenStatus });
  }
  const params = new URL(url).searchParams;
  if (url.includes("/export?")) return new Response("Notulen rapat PPI ".repeat(400));
  const q = params.get("q") ?? "";
  if (q.startsWith("'root-id' in parents")) return Response.json({ files: [file("f-mfk", "03-MFK", { mimeType: "application/vnd.google-apps.folder" }), file("f-notes", "notes", { mimeType: "application/vnd.google-apps.folder" }), file("f-xx", "99-XYZ", { mimeType: "application/vnd.google-apps.folder" })] });
  if (q === "'f-mfk' in parents" && !params.get("pageToken")) return Response.json({ files: [file("a", "APAR.pdf"), file("sub", "Foto", { mimeType: "application/vnd.google-apps.folder" })], nextPageToken: "p2" });
  if (q === "'f-mfk' in parents") return Response.json({ files: [file("b", "Lama.pdf", { trashed: true })] });
  if (q === "'sub' in parents") return Response.json({ files: [file("c", "foto-apar.jpg", { mimeType: "image/jpeg" })] });
  return Response.json({ files: [] });
};

beforeEach(() => {
  tokenStatus = 200; urls = [];
  resetDriveToken();
  vi.stubEnv("MELINDAOS_GOOGLE_SA_JSON", Buffer.from(JSON.stringify(account)).toString("base64"));
  vi.stubEnv("MELINDAOS_STARKES_DRIVE_ROOT", "root-id");
});
afterEach(() => vi.unstubAllEnvs());

describe("listChapterFiles", () => {
  it("reads chapter folders, follows pages and one subfolder level, and keeps trashed flags", async () => {
    const files = await listChapterFiles(fake);
    expect(files.map((f) => [f.id, f.chapterCode, f.trashed])).toEqual([["a", "MFK", false], ["c", "MFK", false], ["b", "MFK", true]]);
    expect(urls.some((u) => u.includes("f-notes") || u.includes("f-xx"))).toBe(false);
    expect(urls.filter((u) => u.includes("pageSize=1000")).length).toBeGreaterThan(0);
  });
  it("reports a rejected service key in plain Indonesian", async () => {
    tokenStatus = 401;
    await expect(listChapterFiles(fake)).rejects.toThrow(DRIVE_DENIED);
  });
});

describe("readMatchText", () => {
  it("exports Google Docs as text capped at 4,000 characters and skips other files", async () => {
    const doc = { id: "d", name: "Notulen", mimeType: "application/vnd.google-apps.document", modifiedTime: "", webViewLink: "", chapterCode: "PPI", trashed: false };
    expect((await readMatchText(doc, fake)).length).toBe(4000);
    expect(await readMatchText({ ...doc, mimeType: "application/pdf" }, fake)).toBe("");
  });
});
