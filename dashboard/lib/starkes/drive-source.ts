import { importPKCS8, SignJWT } from "jose";
import { CHAPTERS } from "./ep-status";

/** Read-only view of the "Accreditation 2027" Drive folder: metadata per file, never the file stored. */
export type DriveFile = { id: string; name: string; mimeType: string; modifiedTime: string; webViewLink: string; chapterCode: string; trashed: boolean };

export const DRIVE_DENIED = "Akses Google Drive ditolak. Periksa kunci layanan.";
export class DriveAccessError extends Error {
  override readonly name = "DriveAccessError";
}

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const FILES_URL = "https://www.googleapis.com/drive/v3/files";
const SCOPE = "https://www.googleapis.com/auth/drive.readonly";
const FOLDER = "application/vnd.google-apps.folder";
const CHAPTER_FOLDER = /^(\d{2})-([A-Z]+)$/;
const TEXT_LIMIT = 4_000;
const EXPORTS: Record<string, string> = { "application/vnd.google-apps.document": "text/plain", "application/vnd.google-apps.spreadsheet": "text/csv" };

type Listed = { id: string; name: string; mimeType: string; modifiedTime: string; webViewLink?: string; trashed?: boolean };

function serviceAccount(): { client_email: string; private_key: string } {
  const raw = process.env.MELINDAOS_GOOGLE_SA_JSON?.trim();
  if (!raw) throw new DriveAccessError("Kunci layanan Google Drive belum dipasang.");
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64").toString("utf8")) as { client_email?: unknown; private_key?: unknown };
    if (typeof parsed.client_email === "string" && typeof parsed.private_key === "string") return { client_email: parsed.client_email, private_key: parsed.private_key };
  } catch { /* reported below */ }
  throw new DriveAccessError("Kunci layanan Google Drive tidak terbaca.");
}

async function accessToken(fetchImpl: typeof fetch): Promise<string> {
  const account = serviceAccount();
  const now = Math.floor(Date.now() / 1000);
  const assertion = await new SignJWT({ scope: SCOPE })
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuer(account.client_email).setAudience(TOKEN_URL).setIssuedAt(now).setExpirationTime(now + 3600)
    .sign(await importPKCS8(account.private_key, "RS256"));
  const response = await fetchImpl(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
  });
  if (!response.ok) throw new DriveAccessError(DRIVE_DENIED);
  const token = ((await response.json()) as { access_token?: unknown }).access_token;
  if (typeof token !== "string") throw new DriveAccessError(DRIVE_DENIED);
  return token;
}

async function driveGet(url: string, token: string, fetchImpl: typeof fetch): Promise<Response> {
  const response = await fetchImpl(url, { headers: { Authorization: `Bearer ${token}` } });
  if (response.status === 401 || response.status === 403) throw new DriveAccessError(DRIVE_DENIED);
  if (!response.ok) throw new DriveAccessError("Google Drive sedang tidak dapat dibaca. Coba lagi nanti.");
  return response;
}

async function listChildren(parent: string, token: string, fetchImpl: typeof fetch, foldersOnly = false): Promise<Listed[]> {
  const files: Listed[] = [];
  let pageToken = "";
  do {
    const query = new URLSearchParams({
      q: `'${parent}' in parents${foldersOnly ? ` and mimeType='${FOLDER}' and trashed=false` : ""}`,
      fields: "nextPageToken,files(id,name,mimeType,modifiedTime,webViewLink,trashed)",
      pageSize: "1000", supportsAllDrives: "true", includeItemsFromAllDrives: "true",
      ...(pageToken ? { pageToken } : {}),
    });
    const page = (await (await driveGet(`${FILES_URL}?${query}`, token, fetchImpl)).json()) as { files?: Listed[]; nextPageToken?: string };
    files.push(...(page.files ?? []));
    pageToken = page.nextPageToken ?? "";
  } while (pageToken);
  return files;
}

let cachedToken: { value: string; until: number } | null = null;
async function token(fetchImpl: typeof fetch): Promise<string> {
  if (cachedToken && cachedToken.until > Date.now()) return cachedToken.value;
  const value = await accessToken(fetchImpl);
  cachedToken = { value, until: Date.now() + 50 * 60_000 };
  return value;
}
export function resetDriveToken(): void { cachedToken = null; }

/** Files in the chapter folders ("03-MFK") of MELINDAOS_STARKES_DRIVE_ROOT and one level of their subfolders. */
export async function listChapterFiles(fetchImpl: typeof fetch = fetch): Promise<DriveFile[]> {
  const root = process.env.MELINDAOS_STARKES_DRIVE_ROOT?.trim();
  if (!root) throw new DriveAccessError("Folder akreditasi Google Drive belum dipasang.");
  const auth = await token(fetchImpl);
  const result: DriveFile[] = [];
  for (const folder of await listChildren(root, auth, fetchImpl, true)) {
    const chapterCode = CHAPTER_FOLDER.exec(folder.name)?.[2];
    if (!chapterCode || !CHAPTERS[chapterCode]) continue;
    for (const item of await listChildren(folder.id, auth, fetchImpl)) {
      const nested = item.mimeType === FOLDER ? (item.trashed ? [] : await listChildren(item.id, auth, fetchImpl)) : [item];
      for (const file of nested.filter((f) => f.mimeType !== FOLDER)) {
        result.push({ id: file.id, name: file.name, mimeType: file.mimeType, modifiedTime: file.modifiedTime, webViewLink: file.webViewLink ?? "", chapterCode, trashed: Boolean(file.trashed || item.trashed) });
      }
    }
  }
  return result;
}

/** Text used for matching: Google Docs/Sheets exported (first 4,000 characters); other files are matched by name. */
export async function readMatchText(file: DriveFile, fetchImpl: typeof fetch = fetch): Promise<string> {
  const exportMime = EXPORTS[file.mimeType];
  if (!exportMime) return "";
  const response = await driveGet(`${FILES_URL}/${encodeURIComponent(file.id)}/export?${new URLSearchParams({ mimeType: exportMime })}`, await token(fetchImpl), fetchImpl);
  return (await response.text()).slice(0, TEXT_LIMIT);
}
