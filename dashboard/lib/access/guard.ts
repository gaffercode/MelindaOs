import { apiBoundary } from "../director/director-api";

export type GuardedHandler = ((request: Request, ctx?: { params?: Promise<unknown> }) => Promise<Response>) & { __guarded: true };

/**
 * The one wrapper every API route should export. It normalises thrown errors through
 * `apiBoundary` (JSON, Indonesian message, 503 on anything unexpected) and marks the handler
 * so `route-guard-coverage.test.ts` can prove every route uses it.
 *
 * It deliberately does NOT resolve permissions: those checks stay exactly where they are
 * today (in the route body or the lib function it calls). This keeps the migration a pure
 * wrapper swap, so bot routes (Medify, unit reports) and the file-mode fallbacks keep working.
 */
export function guard<Ctx = { params?: Promise<unknown> }>(
  handler: (request: Request, ctx: Ctx) => Promise<Response>,
): ((request: Request, ctx?: Ctx) => Promise<Response>) & { __guarded: true } {
  const wrapped = ((request: Request, ctx?: Ctx) => apiBoundary(() => handler(request, ctx as Ctx))) as ((request: Request, ctx?: Ctx) => Promise<Response>) & { __guarded: true };
  wrapped.__guarded = true;
  return wrapped;
}
