import { createHash } from "node:crypto";

export class DirectorStoreError extends Error {
  override readonly name = "DirectorStoreError";
  constructor(public readonly status: number, public readonly code: string) {
    super(status === 409 ? "Versi laporan berubah atau kunci pengiriman sudah digunakan. Muat ulang sebelum mencoba lagi." : status === 404 ? "Pengiriman tidak ditemukan." : "Penyimpanan laporan belum tersedia.");
  }
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  const result = JSON.stringify(value);
  if (result === undefined) throw new Error("Nilai bukan JSON.");
  return result;
}

export function canonicalHash(value: unknown): string {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

export function compareReceivedRevisions(left: { received_at: string; id: string }, right: { received_at: string; id: string }): number {
  return (Date.parse(right.received_at) || 0) - (Date.parse(left.received_at) || 0) || right.id.localeCompare(left.id);
}

export class SupabaseDirectorStore {
  private readonly endpoint: string;
  constructor(url: string, private readonly secret: string, private readonly transport: typeof fetch = fetch, allowLocalHttp = false) {
    const origin = new URL(url);
    if ((origin.protocol !== "https:" && !(allowLocalHttp && origin.protocol === "http:" && ["127.0.0.1", "localhost"].includes(origin.hostname))) || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash || !secret) throw new DirectorStoreError(503, "configuration");
    this.endpoint = `${origin.origin}/rest/v1/rpc/`;
  }

  async call<T>(
    command: string,
    args: Record<string, unknown>,
    rpc:
      | "melinda_director"
      | "melinda_agent"
      | "melinda_director_instructions"
      | "melinda_director_officials"
      | "melinda_director_tasks"
      | "melinda_executive_office"
      | "melinda_pharmacy_orders"
      | "melinda_daily_documents"
      | "melinda_daily_pipeline"
      | "melinda_starkes_audit"
      | "melinda_starkes_evidence"
      | "melinda_studio_documents"
      | "melinda_agent_gateway"
      | "melinda_director_marks"
      | "melinda_director_answers"
      | "melinda_access"
      | "melinda_schema_status"
      | "melinda_referrals" = "melinda_director"
  ): Promise<T> {
    const headers: Record<string, string> = { apikey: this.secret, "Content-Type": "application/json" };
    if (this.secret.startsWith("eyJ")) headers.Authorization = `Bearer ${this.secret}`;
    let response: Response;
    try {
      response = await this.transport(`${this.endpoint}${rpc}`, { method: "POST", headers, body: JSON.stringify({ command, args }), cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10_000) });
    } catch {
      throw new DirectorStoreError(503, "unreachable");
    }
    if (!response.ok) throw new DirectorStoreError(503, response.status === 401 || response.status === 403 ? "unauthorized" : response.status === 404 ? "missing_function" : response.status === 429 || response.status >= 500 ? "unreachable" : "rejected");
    let result: unknown;
    try {
      result = await response.json();
    } catch {
      throw new DirectorStoreError(503, "invalid_response");
    }
    if (!result || typeof result !== "object" || Array.isArray(result)) throw new DirectorStoreError(503, "invalid_response");
    if ("errorCode" in result) {
      const code = result.errorCode;
      throw new DirectorStoreError(code === "conflict" ? 409 : code === "not_found" ? 404 : 503, typeof code === "string" ? code : "invalid_response");
    }
    return result as T;
  }
}
