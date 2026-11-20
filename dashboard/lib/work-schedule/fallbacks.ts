import type { Instruction } from "../director/director-instructions";
import type { OfficeCalendarRow, OfficeReadinessRow } from "../executive/executive-office";
import type { ScheduleRow } from "../tasks/store";
import { buildBaselineSchedule, type StructuralRoleId } from "./baseline-schedule";
import { injectTasksIntoSchedule, resolveVaultTasks } from "./task-vault";

export function buildEnrichedScheduleForRole(
  date: string,
  roleId: StructuralRoleId,
  instructions: readonly Instruction[]
) {
  const tasks = resolveVaultTasks(instructions);
  const baseline = buildBaselineSchedule(date, roleId);
  const slots = injectTasksIntoSchedule(baseline, tasks);
  return { slots, tasks };
}

export function buildFallbackBoardSchedule(
  date: string,
  instructions: readonly Instruction[]
): ScheduleRow[] {
  const { slots } = buildEnrichedScheduleForRole(date, "direktur", instructions);
  return slots.map((slot, index) => ({
    id: slot.id,
    date,
    position: index + 1,
    start: slot.startTime,
    end: slot.endTime,
    title: slot.title,
    place: "RSIA Melinda DHAI",
    pic: [...slot.participants],
    topic: slot.combinedTopicSummary.slice(0, 280),
    producer: "melinda-baseline",
    createdAt: `${date}T06:30:00+07:00`,
    taskIds: slot.injectedTasks.map((t) => t.id),
  }));
}

export function buildFallbackOfficePlan(
  date: string,
  instructions: readonly Instruction[]
): { events: OfficeCalendarRow[]; readiness: OfficeReadinessRow[] } {
  const { slots } = buildEnrichedScheduleForRole(date, "direktur", instructions);
  const meetingSlots = slots.filter(
    (s) => s.category === "Meeting" || s.category === "External" || s.category === "Clinical"
  );

  const events: OfficeCalendarRow[] = meetingSlots.map((slot) => ({
    owner: "director",
    kind: "meeting",
    eventId: slot.id,
    meetingId: slot.id,
    startAt: `${date}T${slot.startTime}:00+07:00`,
    endAt: `${date}T${slot.endTime}:00+07:00`,
    title: slot.title,
    status: "confirmed",
    visibility: "normal",
    sharedWithNovia: true,
    department: slot.domains[0] ?? "Direksi",
  }));

  const readiness: OfficeReadinessRow[] = meetingSlots.map((slot) => ({
    meetingId: slot.id,
    item: "department_materials",
    state: slot.injectedTasks.length > 0 ? "ready" : "blocked",
    evidence:
      slot.injectedTasks.length > 0
        ? `${slot.injectedTasks.length} bahan Task Vault terpasang (${slot.injectedTasks.map((t) => t.id).join(", ")}).`
        : slot.baselineAgenda,
    recordedAt: `${date}T06:30:00+07:00`,
  }));

  return { events, readiness };
}
