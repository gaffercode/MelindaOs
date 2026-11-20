import { NextResponse } from "next/server";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { requirePermission } from "@/lib/access/access-api";
import { guard } from "@/lib/access/guard";
import { apiBoundary, DirectorApiError, readBoundedJson } from "@/lib/director/director-api";
import { protectedDirectorMode } from "@/lib/director/director-auth";
import { repositoryRoot } from "@/lib/repository";

const execFileAsync = promisify(execFile);
const MAX_BODY_BYTES = 64_000;
const EP_ID_PATTERN = /^[A-Za-z0-9_\-:\.]+$/;

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Endpoint to trigger automated document generation for a STARKES Assessment Element (EP).
 * Accessible to hospital staff with 'starkes.use' permission and the Director.
 */
export const POST = guard(async (req: Request) => {
  return apiBoundary(async () => {
    // Both Director and authorized staff can trigger generation (per Gaffer's directive)
    if (protectedDirectorMode()) {
      await requirePermission(req, "starkes.use", true);
    }

    const body = await readBoundedJson(req, MAX_BODY_BYTES);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new DirectorApiError(400, "Format permintaan tidak valid.");
    }

    const { epId, type = "auto" } = body as { epId?: unknown; type?: unknown };

    if (!epId || typeof epId !== "string" || !EP_ID_PATTERN.test(epId)) {
      return NextResponse.json({ error: "epId tidak valid atau tidak disertakan." }, { status: 400 });
    }

    const docType = typeof type === "string" && ["auto", "sk", "spo"].includes(type.toLowerCase()) ? type.toLowerCase() : "auto";

    // Resolve repository root safely without Turbopack whole-project tracing
    const repoRoot = repositoryRoot();
    const runnerScript = path.join(repoRoot, "tools", "doc_generator", "cli_runner.py");

    try {
      const args = ["run", "python", runnerScript, "--ep-id", epId, "--type", docType];
      const { stdout } = await execFileAsync("uv", args, {
        cwd: repoRoot,
        timeout: 35_000,
        maxBuffer: 1_000_000,
      });

      const parsed = JSON.parse(stdout.trim());
      return NextResponse.json({
        success: true,
        data: parsed,
      });
    } catch (error: unknown) {
      console.error("[STARKES DOC GENERATOR ERROR]", error instanceof Error ? error.message : error);
      return NextResponse.json(
        {
          error: "Gagal mengompilasi dokumen akreditasi STARKES.",
          detail: error instanceof Error ? error.message : String(error),
        },
        { status: 500 }
      );
    }
  });
});
