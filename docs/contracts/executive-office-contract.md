# Director Executive Office · read-only plan

Status: read-only. The bot intake that wrote calendar events, outbox items, readiness updates and meeting outcomes (`POST /api/dash/executive/events`, `GET /api/dash/executive/queue`) was removed on 2026-11-12 together with the bot integrations (Katt and Dash). Nothing in MelindaOS writes these records any more; the version of this contract that described the intake is in Git history (commit `e750a88`).

## 1. What remains

The Director's protected view is `/arahan/persiapan`; its read API is `GET /api/director/executive/plan?date=YYYY-MM-DD` (Director session only). It returns the records already stored by migration `202611080002_executive_office.sql` (and `202611080003_executive_nurma_recipient.sql`): `events`, `readiness`, `archives` and `outbox` for that date. If the migration is absent the route fails closed.

## 2. How the stored records read

- **Events.** Director and dr. Novia calendar events. A shared meeting carries the same `meetingId` in both owners' events. An event stored with `visibility:"busy"` holds only **Sibuk**: no title, room, participants or department.
- **Outbox.** Items of kind `assistant_brief` (H-1 16.30 WIB), `department_invitation` (H-1 16.30 WIB) and `readiness_check` (meeting start minus 30 minutes). An outbox item is never a delivery: only a recorded receipt with `state:"sent"` or `state:"failed"` is.
- **Readiness.** Checklist keys `room`, `equipment`, `attendees`, `department_materials`, `agenda`, `director_documents`, `minutes`, each `ready` or `blocked` with its evidence. A meeting is `ready` only if all seven keys are ready, its shared-calendar sync is satisfied and dr. Novia has no conflicting commitment; otherwise the view shows `partial` or `blocked` and never implies an unverified packet was prepared.
- **Archives.** Meeting outcome records, and the immutable source-closure receipt each Director task receives when it is closed as `selesai` (or created with action `done`). A source closure is not VERIFIED_COMPLETED: a staff reply classified `selesai` is a claim.

No phone number is stored. Do not place clinical patient details, passwords, bearer keys, phone numbers or private calendar titles in these records or in logs.
