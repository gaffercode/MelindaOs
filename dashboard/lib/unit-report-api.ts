import { hashSecret } from "./director/director-auth";
import { DirectorApiError, jsonResponse, objectBody, rateLimit, readBoundedJson, requireConfiguration } from "./director/director-api";
import { DailyPipelineValidationError, parseDailyPipelineRegistry, parseSourceReport, semanticReportHash, type DailySourceDefinition } from "./daily/daily-pipeline-contract";
import { DirectorStoreError } from "./director/director-store";

export const UNIT_REPORT_COOKIE = "melinda_unit_report";
const MAX_BODY = 8_192;
const CAPABILITY = /^[A-Za-z0-9_-]{43}$/;
const SCHEDULES = { collect: "06:30", prepare: "07:45", publish: "07:50", alert: "09:00", revisions: ["12:00", "16:00"] };

function origin(request: Request, expected: string): void {
  if (request.headers.get("Origin") !== expected) throw new DirectorApiError(403, "Permintaan laporan unit ditolak.");
}
function capabilityCookie(request: Request): string {
  const value = (request.headers.get("cookie") ?? "").split(";").map((part) => part.trim()).find((part) => part.startsWith(`${UNIT_REPORT_COOKIE}=`))?.slice(UNIT_REPORT_COOKIE.length + 1) ?? "";
  if (!CAPABILITY.test(value)) throw new DirectorApiError(401, "Tautan laporan tidak berlaku atau sudah kedaluwarsa.");
  return value;
}
function validatedSource(value: unknown): DailySourceDefinition {
  return parseDailyPipelineRegistry({ timezone: "Asia/Jakarta", schedules: SCHEDULES, sources: [value] }).sources[0];
}
function priorDate(date: string): string {
  const day = new Date(`${date}T00:00:00Z`); day.setUTCDate(day.getUTCDate() - 1); return day.toISOString().slice(0, 10);
}
function pipelineError(error: unknown): never {
  if (error instanceof DirectorStoreError && error.code === "invalid_capability") throw new DirectorApiError(401, "Tautan laporan tidak berlaku atau sudah kedaluwarsa.");
  if (error instanceof DirectorStoreError && error.code === "conflict") throw new DirectorApiError(409, error.message);
  throw error;
}
async function capabilityScope(config: ReturnType<typeof requireConfiguration>, capability: string) {
  try {
    const result = await config.store.call<{ sourceId: string; reportDate: string; expiresAt: string; source: unknown }>("exchange_capability", { capabilityHash: hashSecret(capability), now: new Date().toISOString() }, "melinda_daily_pipeline");
    return { ...result, source: validatedSource(result.source) };
  } catch (error) { return pipelineError(error); }
}
function scopeResponse(scope: Awaited<ReturnType<typeof capabilityScope>>): Response {
  return jsonResponse({ reportDate: scope.reportDate, source: { id: scope.source.id, label: scope.source.label, numericFields: scope.source.numericFields } }, 200, { "Referrer-Policy": "no-referrer" });
}

export async function exchangeUnitReportCapability(request: Request): Promise<Response> {
  const config = requireConfiguration(); origin(request, config.origin);
  const body = objectBody(await readBoundedJson(request, 512), ["capability"]);
  const capability = typeof body.capability === "string" ? body.capability : "";
  if (!CAPABILITY.test(capability)) throw new DirectorApiError(401, "Tautan laporan tidak berlaku atau sudah kedaluwarsa.");
  const capabilityHash = hashSecret(capability);
  await rateLimit(config, `unit-session:${capabilityHash}`, 10, 900);
  const scope = await capabilityScope(config, capability);
  const maxAge = Math.max(0, Math.min(86_400, Math.floor((Date.parse(scope.expiresAt) - Date.now()) / 1000)));
  const cookie = `${UNIT_REPORT_COOKIE}=${capability}; Path=/api/unit-reports; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${config.secure ? "; Secure" : ""}`;
  const response = scopeResponse(scope);
  response.headers.set("Set-Cookie", cookie);
  return response;
}

export async function resumeUnitReportCapability(request: Request): Promise<Response> {
  const config = requireConfiguration(), capability = capabilityCookie(request);
  return scopeResponse(await capabilityScope(config, capability));
}

export async function submitUnitReport(request: Request): Promise<Response> {
  const config = requireConfiguration(); origin(request, config.origin);
  const capability = capabilityCookie(request), scope = await capabilityScope(config, capability);
  await rateLimit(config, `unit-submit:${hashSecret(capability)}`, 12, 3600);
  const body = objectBody(await readBoundedJson(request, MAX_BODY), ["availability", "issues", "followUp", "decisionNeeded", "metrics"]);
  const now = new Date();
  try {
    const input = parseSourceReport({
      sourceId: scope.source.id,
      reportDate: scope.reportDate,
      periodDate: scope.source.period === "same_day" ? scope.reportDate : priorDate(scope.reportDate),
      observedAt: now.toISOString(),
      ...body,
    }, scope.source, now);
    const receipt = await config.store.call<{ replayed: boolean; revision: number; receipt: string }>("submit_report", { capabilityHash: hashSecret(capability), input, contentHash: semanticReportHash(input), now: now.toISOString() }, "melinda_daily_pipeline");
    return jsonResponse(receipt, receipt.replayed ? 200 : 201, { "Referrer-Policy": "no-referrer" });
  } catch (error) {
    if (error instanceof DailyPipelineValidationError) throw new DirectorApiError(400, "Format laporan unit tidak valid.");
    return pipelineError(error);
  }
}
