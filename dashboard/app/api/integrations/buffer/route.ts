import { NextResponse } from "next/server";
import { apiBoundary, requireHuman } from "@/lib/director/director-api";
import { protectedDirectorMode } from "@/lib/director/director-auth";
import { fetchBufferQueue } from "@/lib/buffer";
import { logError } from "@/lib/log";
import { guard } from "@/lib/access/guard";

export const dynamic = "force-dynamic";

export const GET = guard(async (request?: Request) => {
  if (protectedDirectorMode()) {
    const denied = await apiBoundary(async () => {
      await requireHuman(request ?? new Request("https://local.invalid"));
      return new Response(null, { status: 204 });
    });
    if (denied.status !== 204) return denied;
  }

  try {
    const snapshot = await fetchBufferQueue();
    return NextResponse.json(snapshot, { headers: { "Cache-Control": "no-store" } });
  } catch (error: unknown) {
    logError("buffer_queue_read", error);
    return NextResponse.json(
      { status: "error", posts: [], message: "Antrian Buffer tidak tersedia." },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
});
