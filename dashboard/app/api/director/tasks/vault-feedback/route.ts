import { guard } from "@/lib/access/guard";
import { requirePermission } from "@/lib/access/access-api";
import { apiBoundary, DirectorApiError, jsonResponse } from "@/lib/director/director-api";
import { wibDate } from "@/lib/director/director-data";
import { board } from "@/lib/tasks/store";
import type { StructuralRoleId } from "@/lib/work-schedule/baseline-schedule";
import {
  buildEnrichedScheduleForRole,
  submitVaultTaskFeedback,
} from "@/lib/work-schedule/sync-and-feedback";
import type { VaultTaskStatus } from "@/lib/work-schedule/task-vault";

const VALID_ROLES = new Set<StructuralRoleId>([
  "direktur",
  "wadir_ops",
  "wadir_keu_sdm",
  "kabag_pelayanan",
  "kabag_umum",
  "kabag_penunjang",
  "kepala_sdm",
  "kepala_keuangan",
]);

const VALID_STATUSES = new Set<VaultTaskStatus>([
  "selesai",
  "berjalan",
  "pending_pihak_ketiga",
  "butuh_keputusan_direktur",
  "menunggu_verifikasi_novia",
]);

export const GET = guard((request: Request) =>
  apiBoundary(async () => {
    const { config } = await requirePermission(request, "executive.view");
    const params = new URL(request.url).searchParams;
    const date = params.get("date") ?? wibDate();
    const roleParam = (params.get("role") ?? "direktur") as StructuralRoleId;
    const roleId = VALID_ROLES.has(roleParam) ? roleParam : "direktur";
    const { instructions } = await board(config, { now: new Date().toISOString() }).catch(() => ({
      instructions: [],
    }));
    const enriched = buildEnrichedScheduleForRole(date, roleId, instructions);
    return jsonResponse({ date, roleId, ...enriched });
  })
);

export const POST = guard((request: Request) =>
  apiBoundary(async () => {
    const { config, principal } = await requirePermission(request, "executive.view", true);
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body.taskId !== "string" || typeof body.status !== "string") {
      throw new DirectorApiError(400, "Format umpan balik tugas tidak valid.");
    }
    if (!VALID_STATUSES.has(body.status as VaultTaskStatus)) {
      throw new DirectorApiError(400, "Status tugas tidak dikenal.");
    }
    const result = await submitVaultTaskFeedback(config, {
      date: typeof body.date === "string" ? body.date : wibDate(),
      taskId: body.taskId,
      status: body.status as VaultTaskStatus,
      note: typeof body.note === "string" ? body.note : undefined,
      thirdPartyName: typeof body.thirdPartyName === "string" ? body.thirdPartyName : undefined,
      actorRole: principal.role,
      actorLabel: principal.id || principal.role,
      scheduleSlotId: typeof body.scheduleSlotId === "string" ? body.scheduleSlotId : null,
    });
    return jsonResponse(result, 201);
  })
);
