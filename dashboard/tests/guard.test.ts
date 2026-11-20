import { guard } from "@/lib/access/guard";
import { DirectorApiError } from "@/lib/director/director-api";
import { describe, expect, it } from "vitest";

describe("guard", () => {
  it("marks the handler and passes the response through", async () => {
    const handler = guard(async () => new Response("ok", { status: 200 }));
    expect(handler.__guarded).toBe(true);
    const response = await handler(new Request("https://synthetic.example/api/x"));
    expect(response.status).toBe(200);
  });

  it("normalises a thrown DirectorApiError into JSON", async () => {
    const handler = guard(async () => {
      throw new DirectorApiError(403, "Akses tidak sesuai peran.");
    });
    const response = await handler(new Request("https://synthetic.example/api/x"));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Akses tidak sesuai peran." });
  });

  it("passes the context through to the handler", async () => {
    const handler = guard(async (request, ctx: { params: Promise<{ id: string }> }) => new Response(`${request.method}:${(await ctx.params).id}`, { status: 200 }));
    const response = await handler(new Request("https://synthetic.example/api/x", { method: "GET" }), { params: Promise.resolve({ id: "x" }) });
    expect(await response.text()).toBe("GET:x");
  });
});
