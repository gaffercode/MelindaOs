import type { AskResult } from "./ask/answer";
import type { DashboardData, SearchResult } from "./contracts";

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function fields(value: Record<string, unknown>, keys: string[]): boolean {
  return keys.every((key) => typeof value[key] === "string");
}

function count(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function category(value: unknown): boolean {
  return value === "A" || value === "B" || value === "C";
}

function dashboard(value: unknown): value is DashboardData {
  if (!record(value) || !record(value.validation)) return false;
  const v = value.validation;
  return (v.status === "available" || v.status === "unavailable")
    && fields(v, ["scannedAt", "limitation"]) && Number.isFinite(Date.parse(String(v.scannedAt)))
    && count(v.passed) && count(v.total) && v.passed <= v.total
    && (v.error === undefined || typeof v.error === "string")
    && Array.isArray(v.counts) && v.counts.every((row: unknown) => record(row) && category(row.category) && count(row.passed) && count(row.total) && row.passed <= row.total)
    && Array.isArray(value.providers) && value.providers.every((item: unknown) => record(item) && fields(item, ["name", "authStrategy"]) && strings(item.capabilities) && item.status === "declared")
    && count(value.documentCount);
}

function searchResults(value: unknown): value is SearchResult[] {
  return Array.isArray(value) && value.every((item: unknown) => record(item)
    && fields(item, ["path", "title", "docId", "domain", "department", "lastReviewed", "snippet"])
    && category(item.category) && strings(item.tags) && (item.match === "full" || item.match === "partial"));
}

async function request(path: string, message: string, signal?: AbortSignal): Promise<unknown> {
  const response = await fetch(path, { cache: "no-store", signal });
  if (!response.ok) throw new Error(message);
  try {
    return await response.json();
  } catch (error: unknown) {
    if (signal?.aborted) throw error;
    throw new Error(`${message} Respons bukan JSON valid.`);
  }
}

export async function fetchDashboard(signal?: AbortSignal): Promise<DashboardData> {
  const value = await request("/api/dashboard", "Snapshot repository tidak tersedia. Coba Refresh.", signal);
  if (!dashboard(value)) throw new Error("Format snapshot repository tidak valid. Coba Refresh.");
  return value;
}

export async function fetchSearch(query: string, signal?: AbortSignal): Promise<SearchResult[]> {
  if (query.length > 120) throw new Error("Pencarian maksimal 120 karakter.");
  const value = await request(`/api/search?${new URLSearchParams({ q: query })}`, "Pencarian gagal. Coba lagi.", signal);
  if (!record(value) || !searchResults(value.results)) throw new Error("Format hasil pencarian tidak valid.");
  return value.results;
}

function askResult(value: unknown): value is AskResult {
  return record(value) && ["answered", "not_found", "escalate"].includes(String(value.status)) && typeof value.answer === "string"
    && Array.isArray(value.sources) && value.sources.every((item: unknown) => record(item) && fields(item, ["docId", "title", "heading", "path"]));
}

export async function fetchAsk(question: string): Promise<AskResult> {
  const response = await fetch("/api/ask", { method: "POST", cache: "no-store", headers: { "Content-Type": "application/json", ...(await directorCsrfHeaders()) }, body: JSON.stringify({ question }) });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new Error(record(body) && typeof body.error === "string" ? body.error : "Tanya Melinda sedang tidak tersedia.");
  if (!askResult(body)) throw new Error("Format jawaban tidak valid.");
  return body;
}

/**
 * The session response that carries `csrfToken`. The Director session route answers first, unchanged (file mode included);
 * only its 401 falls back to `/api/access/session`, which answers account principals. Both 401 returns the second 401,
 * which callers already treat as signed out.
 */
export async function sessionResponse(signal?: AbortSignal): Promise<Response> {
  const director = await fetch("/api/director/session", { cache: "no-store", signal });
  if (director.status !== 401) return director;
  return fetch("/api/access/session", { cache: "no-store", signal });
}

// Director write routes check X-CSRF-Token only in protected mode; file mode has no session, so this returns no header.
export async function directorCsrfHeaders(): Promise<Record<string, string>> {
  const response = await sessionResponse();
  if (!response.ok) return {};
  const body: unknown = await response.json().catch(() => null);
  return record(body) && typeof body.csrfToken === "string" ? { "X-CSRF-Token": body.csrfToken } : {};
}
