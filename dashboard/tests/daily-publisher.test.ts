import { scryptSync } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as readNews } from "@/app/api/director/news-edition/route";
import { POST as login } from "@/app/api/director/session/route";
import newsFixture from "@/data/synthetic/news-edition.json";
import { requireConfiguration } from "@/lib/director/director-api";
import { clearDailyDocumentCache, submitDailyDocument } from "@/lib/daily/daily-documents";
import { readNewsEdition } from "@/lib/news/news-edition-store";
import { parseNewsEdition } from "@/lib/news/news-edition-contract";
import { PublisherValidationError } from "@/lib/publisher-contract";

const origin = "https://synthetic.example";
const salt = "00112233445566778899aabbccddeeff";
const passcodeHash = `scrypt$${salt}$${scryptSync("synthetic-test-passcode", salt, 64).toString("hex")}`;
type Row = { id: string; kind: string; report_date: string; producer: string; request_key: string; payload: unknown; payload_hash: string; received_at: string };
let rows: Row[];
let session: { reviewerId: string } | null;
let storeDown: boolean;

function draft<T>(value: T): T { return structuredClone(value); }

describe("news contract", () => {
  it("accepts the synthetic fixture and rejects loose or unsafe documents", () => {
    const news = parseNewsEdition(newsFixture);
    expect(news.date).toBe("2099-01-15");

    const httpSource = draft(news);
    httpSource.edition.lead!.sourceUrl = "http://example.com/not-official";
    expect(() => parseNewsEdition(httpSource)).toThrow(/sourceUrl/);

    const image = draft(news);
    image.edition.lead!.image = "https://example.com/synthetic.png";
    expect(() => parseNewsEdition(image)).toThrow(/imageAlt/);

    const badDate = draft(news);
    badDate.date = "2099-02-31";
    expect(() => parseNewsEdition(badDate)).toThrow(/document\.date/);

    const extra = { ...newsFixture, pasien: "tidak boleh" };
    expect(() => parseNewsEdition(extra)).toThrow(PublisherValidationError);
  });
});

describe("news edition API", () => {
  beforeEach(() => {
    rows = []; session = null; storeDown = false;
    vi.stubEnv("MELINDAOS_DIRECTOR_STORE", "supabase");
    vi.stubEnv("MELINDAOS_APP_ORIGIN", origin);
    vi.stubEnv("MELINDAOS_SUPABASE_URL", "https://synthetic.supabase.co");
    vi.stubEnv("MELINDAOS_SUPABASE_SECRET_KEY", "sb_secret_synthetic");
    vi.stubEnv("MELINDAOS_REVIEWER_PASSCODE_HASH", passcodeHash);
    vi.stubEnv("MELINDAOS_REVIEWER_ID", "director-test");
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      if (storeDown) return new Response("down", { status: 503 });
      const { command, args } = JSON.parse(init.body as string) as { command: string; args: Record<string, unknown> };
      if (command === "rate_limit") return Response.json({ allowed: true });
      if (command === "rate_reset") return Response.json({ ok: true });
      if (command === "session_create") { session = { reviewerId: "director-test" }; return Response.json({ ok: true }); }
      if (command === "session_read") return Response.json({ session });
      expect(url).toContain("/rpc/melinda_daily_documents");
      if (command === "submit") {
        const existing = rows.find((row) => row.kind === args.kind && row.producer === args.producerId && row.request_key === args.key);
        if (existing) return existing.payload_hash === args.payloadHash ? Response.json({ replayed: true, id: existing.id, kind: existing.kind, date: existing.report_date, payloadHash: existing.payload_hash, receivedAt: existing.received_at }) : Response.json({ errorCode: "conflict" });
        const row: Row = { id: `00000000-0000-4000-8000-${String(rows.length + 1).padStart(12, "0")}`, kind: args.kind as string, report_date: args.date as string, producer: args.producerId as string, request_key: args.key as string, payload: args.payload, payload_hash: args.payloadHash as string, received_at: "2099-01-15T00:16:00.000Z" };
        rows.push(row);
        return Response.json({ replayed: false, id: row.id, kind: row.kind, date: row.report_date, payloadHash: row.payload_hash, receivedAt: row.received_at });
      }
      if (command === "read") {
        const matches = rows.filter((row) => row.kind === args.kind && row.report_date === args.date);
        const row = matches.at(-1);
        return Response.json({ document: row ?? null });
      }
      return Response.json({ errorCode: "invalid_command" });
    });
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); clearDailyDocumentCache(); });

  async function directorCookie(): Promise<string> {
    const response = await login(new Request(`${origin}/api/director/session`, { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify({ passcode: "synthetic-test-passcode" }) }));
    expect(response.status).toBe(200);
    return response.headers.get("Set-Cookie")!.split(";")[0];
  }

  it("lets the Director read one edition and keeps an unreadable or tampered row off the page", async () => {
    await submitDailyDocument(requireConfiguration(), "news_edition", { producerId: "test-producer", key: "key-synthetic-pub-6", date: "2099-01-15", payload: newsFixture });
    const cookie = await directorCookie();
    const ok = await readNews(new Request(`${origin}/api/director/news-edition?tanggal=2099-01-15`, { headers: { Cookie: cookie } }));
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { document: { edition: { lead: { headline: string } } } }).document.edition.lead.headline).toBe("Edisi sintetis, bukan berita harian");
    expect((await readNews(new Request(`${origin}/api/director/news-edition?tanggal=2099-01-16`, { headers: { Cookie: cookie } }))).status).toBe(404);
    expect((await readNews(new Request(`${origin}/api/director/news-edition?tanggal=bukan-tanggal`, { headers: { Cookie: cookie } }))).status).toBe(400);
    expect((await readNews(new Request(`${origin}/api/director/news-edition?tanggal=2099-01-15`))).status).toBe(401);
    rows[0].payload_hash = "0".repeat(64);
    clearDailyDocumentCache();
    expect((await readNewsEdition("2099-01-15")).status).toBe("invalid");
    storeDown = true;
    expect((await readNewsEdition("2099-01-15")).status).toBe("invalid");
  });
});
