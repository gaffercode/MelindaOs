import { guard } from "@/lib/access/guard";
import { updateHrdDirectory } from "@/lib/hrd/hrd-api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const PUT = guard(async (request: Request) => updateHrdDirectory(request));
