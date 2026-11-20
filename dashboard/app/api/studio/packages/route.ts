import { apiBoundary, objectBody, readBoundedJson } from "@/lib/director/director-api";
import { studioActor, boundedText } from "@/lib/studio/api";
import { assemblePackage, evaluatePackage } from "@/lib/studio/assemble-package";
import { loadRequirementRegister } from "@/lib/starkes/requirements";
import { loadStudioSourceSnapshot } from "@/lib/studio/source-snapshot";
import { studioStore } from "@/lib/studio/store";
import { packageDefinitions } from "@/lib/studio/package-catalog";
import { guard } from "@/lib/access/guard";

export const runtime = "nodejs";
export const GET = guard(async (request: Request) => {
  return apiBoundary(async () => {
    const actor = await studioActor(request);
    const source = await loadStudioSourceSnapshot(); const register = loadRequirementRegister();
    const packages = await studioStore().list();
    return Response.json({ packages: packages.map((p) => p.documents ? { ...p, issues: evaluatePackage(p, source, register) } : p), role: actor.role,
      templates: packageDefinitions().map(({ key, name }) => ({ key, name })) }, { headers: { "Cache-Control": "private, no-store" } });
  });
});
export const POST = guard(async (request: Request) => {
  return apiBoundary(async () => {
    const actor = await studioActor(request, true);
    const body = objectBody(await readBoundedJson(request, 16_384), ["packageKey"]);
    const packageKey = boundedText(body.packageKey, 100);
    const source = await loadStudioSourceSnapshot(); const register = loadRequirementRegister();
    // Pilot SKP.1 is applicable to patient identification. Other requirements remain unresolved until curated.
    const applicability = Object.fromEntries(register.requirements.filter((r) => r.standardCode === "SKP 1").map((r) => [r.id, "applicable" as const]));
    const pkg = assemblePackage({ packageKey, source, register, applicability });
    return Response.json({ package: await studioStore().create(pkg, actor) }, { status: 201, headers: { "Cache-Control": "no-store" } });
  });
});
