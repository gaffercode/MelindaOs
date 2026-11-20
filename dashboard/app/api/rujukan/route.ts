import { guard } from "@/lib/access/guard";
import { apiBoundary } from "@/lib/director/director-api";
import { submitPublicReferral } from "@/lib/referral/referral-api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Public by design: no session, but same-origin, rate limited, and size limited (see `submitPublicReferral`). */
export const POST = guard(async (request: Request) => apiBoundary(() => submitPublicReferral(request)));
