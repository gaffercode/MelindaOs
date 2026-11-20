import { requirePermission } from "../access/access-api";
import { DirectorApiError, jsonResponse, objectBody, readBoundedJson } from "../director/director-api";
import { HrdValidationError, saveHrdDirectory } from "./hrd-directory";
import { PrivateJsonConflict } from "../storage/private-json";

/** `PUT /api/hrd/directory`: the Director or HR staff replace the staff and officials directory (permission `hrd.edit`). */
export async function updateHrdDirectory(request: Request): Promise<Response> {
  const { principal } = await requirePermission(request, "hrd.edit", true);
  const body = objectBody(await readBoundedJson(request, 262_144), ["officials", "staff", "version"]);
  if (typeof body.version !== "string" || !/^[0-9a-f]{64}$/.test(body.version)) throw new DirectorApiError(400, "Versi data tidak valid. Muat ulang halaman.");
  try {
    const saved = await saveHrdDirectory({ officials: body.officials, staff: body.staff }, { expectedVersion: body.version, actor: { id: principal.id, displayName: principal.displayName } });
    return jsonResponse(saved);
  } catch (error) {
    if (error instanceof HrdValidationError) throw new DirectorApiError(400, error.message);
    if (error instanceof PrivateJsonConflict) throw new DirectorApiError(409, "Data SDM sudah diubah orang lain sejak halaman ini dibuka. Muat ulang halaman, lalu ulangi perubahan Anda.");
    throw error;
  }
}
