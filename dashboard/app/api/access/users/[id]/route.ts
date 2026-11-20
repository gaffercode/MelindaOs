import { updateAccount } from "@/lib/access/access-api";
import { apiBoundary } from "@/lib/director/director-api";
import { guard } from "@/lib/access/guard";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const PATCH = guard(async (request: Request, { params }: { params: Promise<{ id: string }> }) => { return apiBoundary(async () => updateAccount(request, (await params).id)); });
