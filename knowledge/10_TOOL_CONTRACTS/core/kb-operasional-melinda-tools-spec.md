---
doc_id: "SOP-OPS-MELINDA-TOOLS-SPEC"
title: "Melinda Tools Specification v1.0"
domain: "Operasional"
department: "Unit IT"
version: "1.0"
last_reviewed: "2026-09-28"
ftdr_safety_override: false
tags: ["operasional", "unit-it", "core", "melinda-tools-spec"]
governance:
  status: "APPROVED"
  validation_level: "CANONICAL"
  validated_by: "dr. Ferdi Andriska, S.H., M.Kn., CMDC"
  role: "Director in Command"
  date_enacted: "2026-09-28"
  enforcement: "Strict / Mandatory"
---

# Melinda Tools Specification v1.0

**Agent:** Melinda — Hospital Front Office Agent  
**Organization:** RSIA Melinda DHAI  
**Specification date:** 2026-08-28  
**Target architecture:** Remote MCP server + hospital backend adapters  
**Protocol baseline:** Model Context Protocol 2026-07-28  
**Schema baseline:** JSON Schema 2020-12

---

## 1. Mission

Melinda's tools exist to move a patient, family member, visitor, or prospective patient to the **correct administrative next step with minimum friction**, while preserving patient privacy, source-of-truth integrity, and human authority.

The tool layer is intentionally narrower than the hospital's total information system. It exposes only front-office functions that an experienced receptionist or patient-services officer would reasonably need.

---

## 2. Architecture

```text
Patient / Family / Visitor
          │
          ▼
       MELINDA
 Prompt + Skills + Policy
          │
          ▼
  Melinda Hospital MCP
  ├─ Identity / AuthZ
  ├─ Tool policy engine
  ├─ Confirmation enforcement
  ├─ Validation / normalization
  ├─ Idempotency
  ├─ Audit / tracing
  └─ Rate limiting
          │
          ├──────── Hospital Knowledge Base
          ├──────── Doctor / Clinic Master
          ├──────── Scheduling / Appointment System
          ├──────── Registration / Administrative Patient Index
          ├──────── Queue System
          ├──────── Insurance / Payer Gateway
          ├──────── CRM / Complaint System
          ├──────── Human Handoff / Contact Center
          └──────── Notification Provider
```

### 2.1 Source-of-truth rule

Every operational fact MUST resolve to an authoritative source. The model must never be treated as the source of truth for:

- doctor schedules;
- availability;
- tariffs;
- registration requirements;
- insurance eligibility;
- patient identifiers;
- queue status;
- appointment status;
- contact details.

If the authoritative source is unavailable, return a structured unavailable/stale response. Do not fall back to model memory.

### 2.2 MCP server model

Use one logical server surface: **`melinda-hospital-mcp`**.

Internally, adapters may connect to multiple hospital systems. The model should not need to know the vendor, database, or transport used behind each tool.

---

## 3. Tool design rules

Every tool MUST satisfy these rules:

1. **Single purpose** — one obvious business action per tool.
2. **Least privilege** — only data and mutation scope required for that action.
3. **Typed input and output** — explicit schemas; reject unknown fields.
4. **No free-form query execution** — no SQL, shell, URL fetch, or generic HTTP proxy.
5. **Authoritative provenance** — every factual result identifies its source class and freshness.
6. **Minimal PHI** — return only the fields required for the current administrative task.
7. **Explicit mutation semantics** — write tools declare whether they are reversible and idempotent.
8. **Server-side policy** — do not rely on the LLM to enforce access control.
9. **Confirmation where required** — confirmation must be bound to a normalized pending action.
10. **Audited execution** — all sensitive reads and all writes are logged server-side.
11. **Safe failure** — uncertain or unavailable data produces an error/unknown state, never a guessed answer.
12. **Human escalation** — tools may produce a handoff path when automation should stop.

---

## 4. Risk classes

| Class | Meaning | Default behavior |
|---|---|---|
| R0 | Public/non-sensitive read | May execute without confirmation |
| R1 | Operational read | May execute without confirmation; audit recommended |
| R2 | Sensitive administrative read | Authentication/authorization required; audit mandatory |
| R3 | Reversible mutation | Explicit user confirmation required before commit |
| R4 | External communication or consequential mutation | Explicit confirmation + stronger audit |
| R5 | Prohibited for Melinda | Tool MUST NOT exist |

Examples of R5: clinical record modification, prescribing, arbitrary SQL, billing adjustment, credential management.

---

## 5. Canonical tool catalog

### 5.1 `hospital.search_knowledge`

**Purpose:** Search approved hospital administrative knowledge such as SOP-facing guidance, registration requirements, service descriptions, visitor information, and FAQs.

**Risk:** R0/R1  
**Mutation:** No  
**Confirmation:** No

**Input**
- `query` — natural-language question, 3–500 chars.
- `category` — optional controlled category.
- `locale` — optional language/locale.
- `top_k` — optional, 1–8.

**Output**
- ranked `results`;
- each result includes `title`, `answer_snippet`, `source_id`, `source_type`, `updated_at`, and optional `effective_from/effective_until`;
- `freshness_status`: `current | potentially_stale | unknown`.

**Rules**
- Search only approved hospital sources.
- Never search private patient data.
- Never synthesize a policy when no source matches.

---

### 5.2 `hospital.get_contact`

**Purpose:** Return verified contact/routing information for a hospital department or service.

**Risk:** R0  
**Mutation:** No

**Input**
- `department_or_service`;
- optional `channel`: `phone | whatsapp | email | in_person`.

**Output**
- canonical department name;
- contact route(s);
- operating note;
- source metadata.

---

### 5.3 `hospital.get_operating_hours`

**Purpose:** Return official operating hours for hospital, clinic, service, or department.

**Risk:** R0  
**Mutation:** No

**Input**
- `service_or_department`;
- optional `date`.

**Output**
- local timezone;
- open/closed/unknown;
- opening windows;
- exception/holiday note when known;
- source metadata.

---

### 5.4 `doctor.search`

**Purpose:** Find physicians by name, specialty, service, or clinical department.

**Risk:** R0  
**Mutation:** No

**Input**
- optional `name`;
- optional `specialty`;
- optional `service`;
- optional `language`;
- optional `active_only` default `true`.

**Output**
- doctor IDs;
- display names;
- specialties;
- service/clinic affiliation;
- profile availability.

**Boundary**
- Do not rank doctors by unverifiable quality claims.
- Do not infer clinical suitability beyond structured service/specialty metadata.

---

### 5.5 `doctor.get_profile`

**Purpose:** Return approved public-facing doctor profile information.

**Risk:** R0  
**Mutation:** No

**Input**
- `doctor_id`.

**Output**
- name;
- credentials as stored in source;
- specialty;
- clinic/service;
- public biography fields;
- source metadata.

---

### 5.6 `doctor.get_schedule`

**Purpose:** Return verified practice schedule for a doctor.

**Risk:** R1  
**Mutation:** No

**Input**
- `doctor_id`;
- `date_from`;
- `date_to` with server-enforced maximum range;
- optional `location_id`.

**Output**
- dated schedule blocks;
- status: `scheduled | unavailable | cancelled | unknown`;
- source freshness;
- `last_synced_at`.

**Rules**
- "Scheduled" is not equivalent to "appointment slot available."
- Use `appointment.find_slots` for availability.

---

### 5.7 `service.search`

**Purpose:** Find hospital services, clinics, facilities, packages, and administrative pathways.

**Risk:** R0  
**Mutation:** No

**Input**
- `query`;
- optional `category`.

**Output**
- service IDs;
- names;
- short descriptions;
- location;
- relevant routing metadata.

---

### 5.8 `service.get_details`

**Purpose:** Return authoritative service details and administrative prerequisites.

**Risk:** R0/R1  
**Mutation:** No

**Input**
- `service_id`;
- optional `patient_context`: `new_patient | existing_patient | referral | insurance | self_pay`.

**Output**
- service description;
- requirements;
- documents;
- preparation statements approved for front office;
- location;
- contacts;
- source metadata.

**Boundary**
- Clinical preparation instructions must come from an approved source, not model generation.

---

### 5.9 `service.get_tariff`

**Purpose:** Return official published or authorized administrative tariff information.

**Risk:** R1  
**Mutation:** No

**Input**
- `service_id`;
- optional `payer_type`;
- optional `price_context`.

**Output**
- amount or range;
- currency;
- price basis;
- inclusions/exclusions when explicitly stored;
- effective date;
- disclaimer/status if estimate only;
- source metadata.

**Rules**
- Never infer a price.
- Never claim payer coverage from tariff data.
- Use `insurance.check_eligibility` for payer-specific eligibility.

---

### 5.10 `appointment.find_slots`

**Purpose:** Find actual bookable appointment slots.

**Risk:** R1  
**Mutation:** No

**Input**
- `doctor_id` or `service_id`;
- `date_from`;
- `date_to`;
- optional `time_preference`;
- optional `location_id`;
- optional `payer_type`.

**Output**
- bookable `slot_id`s;
- local date/time;
- doctor/service;
- location;
- hold capability if supported;
- freshness timestamp.

**Rules**
- Only return slots reported as bookable by source system.
- A returned slot is not booked until `appointment.create` succeeds.

---

### 5.11 `appointment.get`

**Purpose:** Retrieve one appointment after authorized identity matching.

**Risk:** R2  
**Mutation:** No  
**Authentication:** Required  
**Audit:** Mandatory

**Input**
- `appointment_reference`;
- identity-verification token or server-resolved subject context.

**Output**
- appointment ID/reference;
- patient display-safe identity;
- doctor/service;
- date/time;
- location;
- administrative status;
- reschedule/cancel eligibility.

**Boundary**
- No clinical note, diagnosis, reason-for-visit detail beyond what is administratively necessary.

---

### 5.12 `appointment.create`

**Purpose:** Create a confirmed appointment.

**Risk:** R3  
**Mutation:** Yes, reversible subject to policy  
**Confirmation:** Required  
**Idempotency:** Required  
**Audit:** Mandatory

**Input**
- `slot_id`;
- patient identity reference or pre-registration token;
- contact preference;
- payer type when required;
- `confirmation_token`;
- `idempotency_key`.

**Output**
- appointment reference;
- confirmed date/time;
- doctor/service;
- location;
- status;
- next-step instructions.

**Preconditions**
1. slot still available;
2. patient identity/pre-registration sufficient;
3. confirmation token matches exact normalized action;
4. source system confirms commit.

---

### 5.13 `appointment.reschedule`

**Purpose:** Move an existing appointment to a different slot.

**Risk:** R3  
**Mutation:** Yes  
**Confirmation:** Required  
**Idempotency:** Required  
**Authentication:** Required

**Input**
- `appointment_reference`;
- `new_slot_id`;
- verified subject context;
- `confirmation_token`;
- `idempotency_key`.

**Output**
- old appointment summary;
- new confirmed appointment summary;
- status.

**Rules**
- Must not cancel the old booking unless the new booking transaction can be committed according to backend transaction policy.
- If atomic replacement is not supported, surface this limitation before confirmation.

---

### 5.14 `appointment.cancel`

**Purpose:** Cancel an existing appointment.

**Risk:** R4  
**Mutation:** Yes, potentially consequential  
**Confirmation:** Required  
**Authentication:** Required  
**Audit:** Mandatory

**Input**
- `appointment_reference`;
- optional controlled `reason_code`;
- verified subject context;
- `confirmation_token`;
- `idempotency_key`.

**Output**
- cancellation status;
- cancellation timestamp;
- any source-provided rebooking guidance.

**Rules**
- Never cancel from ambiguous intent.
- "I may not be able to come" is not confirmation to cancel.

---

### 5.15 `patient.pre_register`

**Purpose:** Create minimum administrative pre-registration for a prospective/new patient.

**Risk:** R3  
**Mutation:** Yes  
**Confirmation:** Required  
**Audit:** Mandatory

**Input**
- minimum demographics required by hospital policy;
- contact details;
- optional government/insurance identifiers only when required;
- consent/notice acknowledgement;
- `confirmation_token`;
- `idempotency_key`.

**Output**
- pre-registration reference/token;
- fields accepted;
- missing required fields;
- next step.

**Data minimization**
- Do not request or store clinical history through this tool.
- Do not request sensitive identifiers earlier than necessary.

---

### 5.16 `patient.resolve_administrative_identity`

**Purpose:** Resolve an existing patient identity for administrative workflows without exposing a broad patient record.

**Risk:** R2  
**Mutation:** No  
**Authentication:** Required  
**Audit:** Mandatory

**Input**
- approved identity-match fields;
- interaction/session context.

**Output**
- opaque `patient_ref`;
- masked display identity;
- match confidence/status: `verified | ambiguous | not_found`;
- allowed next actions.

**Rules**
- Never return a patient search result list containing unrelated people.
- Ambiguous matches require human verification.

---

### 5.17 `queue.get_status`

**Purpose:** Return queue status for an authenticated/verified patient or a non-sensitive public queue identifier.

**Risk:** R1/R2 depending implementation  
**Mutation:** No

**Input**
- `queue_reference` or authorized appointment reference.

**Output**
- queue number/status;
- service;
- estimated operational wait only if source system provides it;
- last updated timestamp.

**Rule**
- Do not generate wait-time estimates from model reasoning.

---

### 5.18 `insurance.check_eligibility`

**Purpose:** Check administrative eligibility/coverage status from an authorized payer or hospital eligibility source.

**Risk:** R2  
**Mutation:** No  
**Authentication:** Required  
**Audit:** Mandatory

**Input**
- patient reference;
- payer/plan identifier;
- service/date context when required.

**Output**
- `eligible | not_eligible | requires_review | unavailable`;
- authorization/reference if provided;
- scope/limitations explicitly returned by source;
- freshness timestamp.

**Boundary**
- Eligibility is not a guarantee of final payment.
- Never interpret insurance terms beyond returned structured data.

---

### 5.19 `complaint.create_ticket`

**Purpose:** Create a patient-service complaint or feedback ticket.

**Risk:** R3  
**Mutation:** Yes  
**Confirmation:** Required  
**Audit:** Mandatory

**Input**
- category;
- user-provided summary;
- preferred contact route;
- patient/visitor reference only when needed;
- urgency flags;
- `confirmation_token`;
- `idempotency_key`.

**Output**
- ticket reference;
- assigned destination/team if known;
- expected next step if defined by source policy.

**Rules**
- Preserve the user's wording faithfully.
- Do not rewrite a complaint to make it less serious.
- Safety or clinical-risk complaints should also trigger human escalation.

---

### 5.20 `complaint.get_status`

**Purpose:** Retrieve the status of a complaint/feedback ticket.

**Risk:** R2  
**Mutation:** No  
**Authentication:** Required when ticket is linked to a person.

**Input**
- `ticket_reference`;
- subject verification when required.

**Output**
- status;
- assigned department when allowed;
- latest approved status message;
- next step.

---

### 5.21 `handoff.create`

**Purpose:** Create a structured handoff to human staff or an authorized department.

**Risk:** R3  
**Mutation:** Yes  
**Confirmation:** Usually not required when handoff is the user's requested next step; required before sharing sensitive data beyond the existing purpose.  
**Audit:** Mandatory

**Input**
- destination;
- reason code;
- concise case summary;
- contact preference;
- sensitivity classification;
- conversation reference;
- optional patient reference when authorized.

**Output**
- handoff reference;
- destination;
- status;
- expected channel/next step if available.

**Handoff summary format**
- what the user needs;
- what has already been verified;
- actions already attempted;
- unresolved issue;
- minimum identity/context needed by staff.

---

### 5.22 `notification.send`

**Purpose:** Send a transactional confirmation, reminder, or handoff notification through an approved provider.

**Risk:** R4  
**Mutation/external effect:** Yes  
**Confirmation:** Required unless message is a system-mandated consequence of an already-confirmed transaction and hospital policy explicitly permits automatic sending.  
**Audit:** Mandatory

**Input**
- recipient reference, not arbitrary destination when possible;
- approved template ID;
- structured template variables;
- channel;
- `confirmation_token` when required;
- `idempotency_key`.

**Output**
- delivery request ID;
- channel;
- accepted/rejected status.

**Rules**
- Prefer approved templates.
- No arbitrary bulk messaging.
- No marketing messages in this tool.

---

## 6. Tools intentionally NOT exposed

The following capabilities are prohibited for Melinda v1:

```text
database.query
sql.execute
shell.execute
http.fetch_arbitrary
patient.get_full_record
patient.search_all
clinical.get_notes
clinical.write_note
clinical.modify_diagnosis
clinical.order
clinical.prescribe
lab.modify_result
billing.adjust_amount
billing.refund
insurance.override
identity.change_credentials
user.manage_roles
notification.bulk_send
file.upload_arbitrary
file.delete
```

If a developer adds a generic tool that can indirectly perform these actions, the implementation is non-conformant even if the tool has a different name.

---

## 7. Confirmation architecture

Write actions MUST use a two-phase pattern.

### Phase A — Prepare / normalize

The server or application builds a normalized pending action:

```json
{
  "action": "appointment.create",
  "subject": "patient_ref:opaque",
  "doctor": "Dr. Example",
  "service": "Obstetrics Clinic",
  "date_time": "2026-09-01T10:30:00+07:00",
  "location": "RSIA Melinda DHAI",
  "expires_at": "..."
}
```

The user is shown a clear summary.

### Phase B — Commit

Only after explicit confirmation is received, a short-lived `confirmation_token` bound to the exact pending action is passed to the write tool.

A confirmation token MUST NOT be reusable for:
- a different patient;
- a different slot;
- a different destination;
- a changed complaint body;
- a changed recipient;
- a later transaction after expiration.

---

## 8. Idempotency

Every mutation tool MUST accept an `idempotency_key`.

Server behavior:
- same key + same normalized payload → return original result;
- same key + different payload → reject with `IDEMPOTENCY_CONFLICT`;
- keys have a documented retention window;
- retries must not create duplicate appointments, tickets, registrations, or messages.

---

## 9. Authentication and authorization

Authorization MUST be enforced on the server, independently of the model.

Minimum requirements:
- user/session identity when accessing patient-linked information;
- scopes per tool;
- hospital staff/system identity for backend service calls;
- no credentials embedded in prompts, Skills, or Files;
- secrets kept server-side;
- least-privilege service accounts;
- tenant/environment separation;
- short-lived credentials/tokens where supported.

Suggested scopes:

```text
hospital.public.read
doctor.public.read
schedule.read
service.read
tariff.read
appointment.read.self
appointment.write.self
patient.admin.resolve
patient.preregister
queue.read.self
insurance.eligibility.self
complaint.write
complaint.read.self
handoff.write
notification.transactional.send
```

---

## 10. Data classification

| Class | Example | Tool handling |
|---|---|---|
| D0 Public | services, public contacts | normal |
| D1 Internal operational | sync state, internal routing | minimize |
| D2 Personal administrative | name, phone, appointment | auth + audit |
| D3 Sensitive identifier | national/payer ID | strict minimization + masking |
| D4 Clinical | diagnosis, notes, results | outside Melinda tool scope |

Tool outputs should return opaque references instead of raw identifiers whenever possible.

---

## 11. Output provenance and freshness

Operational read tools MUST expose provenance metadata:

```json
{
  "source": {
    "system": "appointment_system",
    "record_version": "optional",
    "retrieved_at": "2026-08-28T03:00:00+07:00",
    "last_updated_at": "2026-08-28T02:58:11+07:00"
  }
}
```

For data prone to change, include a `freshness_status`.

Do not label data `current` merely because the MCP call succeeded. `current` must mean the source system has supplied a sufficiently recent authoritative value according to tool-specific policy.

---

## 12. Error contract

All tools use one normalized error envelope.

```json
{
  "ok": false,
  "error": {
    "code": "SLOT_NO_LONGER_AVAILABLE",
    "message": "The selected appointment slot is no longer available.",
    "retryable": false,
    "safe_user_message": "That appointment slot has just become unavailable. I can look for another time.",
    "handoff_recommended": false,
    "correlation_id": "..."
  }
}
```

The model should receive actionable, safe errors rather than raw stack traces or database messages.

See `kb-operasional-error-contract.md`.

---

## 13. Audit requirements

Audit is infrastructure, **not a model-callable tool**.

Mandatory events:
- all D2/D3 reads;
- identity matching;
- insurance checks;
- appointment mutations;
- pre-registration;
- complaint creation/status reads;
- human handoffs;
- notifications;
- authorization failures;
- confirmation failures;
- policy denials.

Do not log more patient content than necessary. Never log secrets, raw credentials, or unnecessary full conversation bodies.

See `AUDIT_OBSERVABILITY.md`.

---

## 14. Tool selection rules for Melinda

1. Use knowledge search for administrative guidance.
2. Use structured operational tools for dynamic facts.
3. If a dynamic source is unavailable, say it cannot currently be verified.
4. Read before write.
5. Never perform a write based on inferred intent.
6. Do not ask the patient for information the server already securely knows and is allowed to reuse.
7. If identity cannot be verified, stop sensitive workflows and hand off.
8. If an action has clinical implications or exceeds front-office authority, hand off.
9. When multiple systems disagree, surface the conflict and prefer human resolution rather than silently choosing.
10. Never use a public web search as a substitute for hospital operational truth.

---

## 15. Recommended rollout

### Stage 0 — Sandbox
All tools use test data and non-production endpoints.

### Stage 1 — Read-only production
Enable:
- `hospital.*`
- `doctor.*`
- `service.*`
- `appointment.find_slots`
- `queue.get_status` where non-sensitive
No mutations.

### Stage 2 — Controlled appointments
Enable:
- identity resolution;
- `appointment.get/create/reschedule/cancel`;
- confirmation tokens;
- idempotency;
- full audit.

### Stage 3 — Administrative workflows
Enable:
- `patient.pre_register`;
- insurance eligibility;
- complaint tickets;
- handoff.

### Stage 4 — Transactional messaging
Enable approved template notifications after channel policy and consent are validated.

No stage automatically authorizes a future clinical tool.

---

## 16. Definition of production-ready

Melinda Tools v1 is production-ready only when:

- every tool has an owner and authoritative source;
- JSON schemas are validated;
- authorization is enforced server-side;
- sensitive reads are audited;
- write confirmation is cryptographically/session-bound or equivalently tamper-resistant;
- mutation tools are idempotent;
- duplicate/retry scenarios are tested;
- stale-source behavior is defined;
- all prohibited-capability tests pass;
- no raw database or generic execution tool is exposed;
- red-team tests show that prompt injection cannot bypass authorization or confirmations;
- human handoff works when automation cannot safely continue;
- rollback/disable control exists per tool;
- production monitoring and alerting are configured.

---

## 17. References / standards baseline

This specification is aligned to the MCP 2026-07-28 generation of the protocol, which introduced a stateless core and full JSON Schema 2020-12 support for tool schemas. It also follows the principle that risk annotations are hints, not a substitute for real authorization/policy enforcement. For OpenAI integrations, function/tool schemas should be strict where supported, while authorization and business-policy checks remain server-side.

Primary references:
- Model Context Protocol — 2026-07-28 specification release
- Model Context Protocol — Tool annotation/risk guidance
- OpenAI — Function Calling / Structured Outputs
- OpenAI — Apps SDK / MCP integration
