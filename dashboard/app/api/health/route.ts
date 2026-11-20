import { access } from "node:fs/promises";
import { authConfiguration, medifyPublisherConfiguration, protectedDirectorMode } from "@/lib/director/director-auth";
import { knowledgeIndexPath } from "@/lib/repository";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  let director: "configured" | "not_configured" = "not_configured";
  try { if (authConfiguration()) director = "configured"; } catch { director = "not_configured"; }
  const medifyPublisher = medifyPublisherConfiguration() ? "configured" : "not_configured";
  const knowledgeIndex = await access(knowledgeIndexPath()).then(() => "present" as const, () => "absent" as const);
  return Response.json({ status: "ok", mode: protectedDirectorMode() ? "protected" : "local", director, medifyPublisher, knowledgeIndex }, { headers: { "Cache-Control": "no-store" } });
}
