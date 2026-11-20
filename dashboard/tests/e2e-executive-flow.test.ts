import { scryptSync } from "node:crypto";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as sessionGet, POST as loginPost } from "@/app/api/director/session/route";
import { POST as syncTodayPost } from "@/app/api/director/tasks/sync-today/route";
import {
  GET as vaultFeedbackGet,
  POST as vaultFeedbackPost,
} from "@/app/api/director/tasks/vault-feedback/route";
import { GET as boardGet } from "@/app/api/director/tasks/board/route";
import { GET as execPlanGet } from "@/app/api/director/executive/plan/route";
import { GET as briefGet } from "@/app/api/director/melinda-brief/route";
import { GET as newsGet } from "@/app/api/director/news-edition/route";
import { MelindaBriefGate } from "@/components/melinda-brief/melinda-brief-gate";
import { NewsEditionGate } from "@/components/news/news-edition-view";
import { clearDailyDocumentCache } from "@/lib/daily/daily-documents";

const origin = "https://synthetic.example";
const salt = "00112233445566778899aabbccddeeff";
const passcode = "e2e-executive-passcode-123";

describe("E2E Executive Scheduling & Full-Page Auto-Fill Flow", () => {
  const docs = new Map<string, Record<string, unknown>>();
  const sessions = new Map<string, { reviewerId: string }>();
  const instructions: Record<string, unknown>[] = [];
  let scheduleItems: Record<string, unknown>[] = [];

  beforeEach(() => {
    docs.clear();
    sessions.clear();
    instructions.length = 0;
    scheduleItems = [];
    clearDailyDocumentCache();

    vi.stubEnv("MELINDAOS_DIRECTOR_STORE", "supabase");
    vi.stubEnv("MELINDAOS_APP_ORIGIN", origin);
    vi.stubEnv("MELINDAOS_SUPABASE_URL", "https://synthetic.supabase.co");
    vi.stubEnv("MELINDAOS_SUPABASE_SECRET_KEY", "sb_secret_synthetic");
    vi.stubEnv("MELINDAOS_REVIEWER_ID", "director-e2e");
    vi.stubEnv(
      "MELINDAOS_REVIEWER_PASSCODE_HASH",
      `scrypt$${salt}$${scryptSync(passcode, salt, 64).toString("hex")}`
    );

    vi.stubGlobal("fetch", async (_url: string, init?: RequestInit) => {
      const body = JSON.parse((init?.body as string) || "{}") as {
        command?: string;
        args?: Record<string, unknown>;
      };
      const cmd = body.command;
      const args = body.args ?? {};

      if (cmd === "rate_limit") return Response.json({ allowed: true });
      if (cmd === "audit") return Response.json({ ok: true });
      if (cmd === "users_count") return Response.json({ count: 0 });
      if (cmd === "session_create") {
        sessions.set(String(args.tokenHash), { reviewerId: String(args.reviewerId) });
        return Response.json({ ok: true });
      }
      if (cmd === "session_read") {
        const session = sessions.get(String(args.tokenHash)) ?? null;
        return Response.json({ session });
      }
      if (cmd === "submit") {
        const key = `${args.kind}:${args.date}`;
        docs.set(key, {
          id: "00000000-0000-4000-8000-000000000001",
          kind: args.kind,
          report_date: args.date,
          producer: args.producerId ?? "melinda-sync-today",
          payload: args.payload,
          payload_hash: args.payloadHash ?? "hash-e2e",
          received_at: "2026-11-19T01:00:00.000Z",
        });
        return Response.json({
          replayed: false,
          id: "00000000-0000-4000-8000-000000000001",
          kind: args.kind,
          date: args.date,
          payloadHash: args.payloadHash,
          receivedAt: "2026-11-19T01:00:00.000Z",
        });
      }
      if (cmd === "read") {
        const doc = docs.get(`${args.kind}:${args.date}`) ?? null;
        return Response.json({ document: doc });
      }
      if (cmd === "board") return Response.json({ instructions });
      if (cmd === "schedule_list") return Response.json({ date: args.date, items: scheduleItems });
      if (cmd === "schedule_replace") {
        scheduleItems = ((args.items as Record<string, unknown>[]) ?? []).map((it, idx) => ({
          id: `sch-${idx}`,
          date: args.date,
          position: idx + 1,
          ...it,
          producer: args.producer,
          createdAt: "2026-11-19T01:00:00.000Z",
          taskIds: [],
        }));
        return Response.json({ date: args.date, count: scheduleItems.length });
      }
      if (cmd === "create") {
        const ins = {
          id: `IOC-${9100 + instructions.length}`,
          ...args,
          action: args.action ?? "follow_up",
          deadline: args.deadline ?? null,
          remindersSent: 0,
          lastReminderAt: null,
          latestReply: null,
          status: "dibuat",
          history: [{ status: "dibuat", at: "2026-11-19T01:00:00.000Z", actor: args.reviewerId ?? "Direktur" }],
          createdAt: "2026-11-19T01:00:00.000Z",
        };
        instructions.push(ins);
        return Response.json({ instruction: ins, replayed: false });
      }
      if (cmd === "plan") {
        return Response.json({ date: args.date, events: [], readiness: [], outbox: [], archives: [] });
      }
      if (cmd === "review_list") return Response.json({ pending: [] });
      if (cmd === "list_marks") return Response.json({ marks: [] });
      return Response.json({ ok: true });
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    clearDailyDocumentCache();
  });

  it("executes full flow: login -> 1-click sync -> API reads -> closed-loop feedback -> SSR rendering of / and /berita", async () => {
    // 1. Login as Director
    const loginRes = await loginPost(
      new Request(`${origin}/api/director/session`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: origin },
        body: JSON.stringify({ passcode }),
      })
    );
    expect(loginRes.status).toBe(200);
    const cookie = (loginRes.headers.get("set-cookie") ?? "").split(";")[0]!;

    const sessRes = await sessionGet(
      new Request(`${origin}/api/director/session`, { headers: { Cookie: cookie } })
    );
    expect(sessRes.status).toBe(200);
    const sess = (await sessRes.json()) as { reviewerId: string; role: string; csrfToken: string };
    expect(sess.role).toBe("director");
    expect(sess.reviewerId).toBe("director-e2e");
    expect(sess.csrfToken).toBeTruthy();

    // 2. 1-Click "Sinkronkan hari ini"
    const syncRes = await syncTodayPost(
      new Request(`${origin}/api/director/tasks/sync-today`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: origin,
          Cookie: cookie,
          "X-CSRF-Token": sess.csrfToken,
        },
        body: JSON.stringify({ date: "2026-11-19" }),
      })
    );
    expect(syncRes.status).toBe(200);
    const syncData = (await syncRes.json()) as {
      scheduleCount: number;
      openTasksCount: number;
      briefComposed: boolean;
      newsComposed: boolean;
    };
    expect(syncData.briefComposed).toBe(true);
    expect(syncData.newsComposed).toBe(true);
    expect(syncData.scheduleCount).toBeGreaterThanOrEqual(8);
    expect(syncData.openTasksCount).toBeGreaterThanOrEqual(20);

    // 3. Verify stored brief & news edition via API
    const briefApi = await briefGet(
      new Request(`${origin}/api/director/melinda-brief?tanggal=2026-11-19`, {
        headers: { Cookie: cookie },
      })
    );
    expect(briefApi.status).toBe(200);
    const briefJson = (await briefApi.json()) as { status: string; brief: { schedule: { items: unknown[] } } };
    expect(briefJson.status).toBe("current");
    expect(briefJson.brief.schedule.items.length).toBeGreaterThanOrEqual(8);

    const newsApi = await newsGet(
      new Request(`${origin}/api/director/news-edition?tanggal=2026-11-19`, {
        headers: { Cookie: cookie },
      })
    );
    expect(newsApi.status).toBe(200);

    // 4. Verify /arahan board & /arahan/persiapan plan endpoints are populated
    const boardRes = await boardGet(
      new Request(`${origin}/api/director/tasks/board`, { headers: { Cookie: cookie } })
    );
    expect(boardRes.status).toBe(200);
    const boardJson = (await boardRes.json()) as { schedule: unknown[]; vaultTasks: unknown[] };
    expect(boardJson.schedule.length).toBeGreaterThanOrEqual(8);
    expect(boardJson.vaultTasks.length).toBeGreaterThanOrEqual(20);

    const planRes = await execPlanGet(
      new Request(`${origin}/api/director/executive/plan?date=2026-11-19`, {
        headers: { Cookie: cookie },
      })
    );
    expect(planRes.status).toBe(200);
    const planJson = (await planRes.json()) as { events: unknown[]; meetings: unknown[] };
    expect(planJson.events.length).toBeGreaterThanOrEqual(3);
    expect(planJson.meetings.length).toBeGreaterThanOrEqual(3);

    // 5. Closed-loop feedback update via POST /api/director/tasks/vault-feedback
    const fbRes = await vaultFeedbackPost(
      new Request(`${origin}/api/director/tasks/vault-feedback`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: origin,
          Cookie: cookie,
          "X-CSRF-Token": sess.csrfToken,
        },
        body: JSON.stringify({
          date: "2026-11-19",
          taskId: "ACT-2810-01",
          status: "pending_pihak_ketiga",
          thirdPartyName: "Mitra Contoh",
          note: "Menunggu audit contoh",
        }),
      })
    );
    expect(fbRes.status).toBe(201);

    const vaultAfter = await vaultFeedbackGet(
      new Request(`${origin}/api/director/tasks/vault-feedback?date=2026-11-19&role=direktur`, {
        headers: { Cookie: cookie },
      })
    );
    expect(vaultAfter.status).toBe(200);
    const vaultJson = (await vaultAfter.json()) as {
      tasks: { id: string; status: string; latestNote?: string }[];
    };
    const updatedTask = vaultJson.tasks.find((t) => t.id === "ACT-2810-01");
    expect(updatedTask?.status).toBe("pending_pihak_ketiga");
    expect(updatedTask?.latestNote).toBe("Menunggu audit contoh");

    // 6. SSR Render check for / (MelindaBriefGate) and /berita (NewsEditionGate)
    const homeHtml = renderToStaticMarkup(await MelindaBriefGate({ date: "2026-11-19" }));
    expect(homeHtml).toContain("Sinkronkan hari ini");
    expect(homeHtml).toContain("(tertutup-keuangan-sdm)");
    expect(homeHtml).toContain("Jadwal struktural 8 jabatan");

    const newsHtml = renderToStaticMarkup(await NewsEditionGate({ date: "2026-11-19" }));
    expect(newsHtml).toContain("Warta &amp; Regulasi");
    expect(newsHtml).toContain("Sinkronkan warta hari ini");
    expect(newsHtml).toContain("Permenkes No. 6 Tahun 2026");
  });
});
