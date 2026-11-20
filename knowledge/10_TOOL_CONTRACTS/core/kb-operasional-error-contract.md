---
doc_id: "SOP-OPS-ERROR-CONTRACT"
title: "Error Contract"
domain: "Operasional"
department: "Unit IT"
version: "1.0"
last_reviewed: "2026-09-28"
ftdr_safety_override: false
tags: ["operasional", "unit-it", "core", "error-contract"]
governance:
  status: "APPROVED"
  validation_level: "CANONICAL"
  validated_by: "dr. Ferdi Andriska, S.H., M.Kn., CMDC"
  role: "Director in Command"
  date_enacted: "2026-09-28"
  enforcement: "Strict / Mandatory"
---

# Error Contract

Every tool must return either a typed success result or the normalized error envelope.

## Canonical error codes

| Code | Meaning | Retryable | Typical agent behavior |
|---|---|---:|---|
| INVALID_INPUT | Schema/business validation failed | No | Ask for corrected field |
| AUTHENTICATION_REQUIRED | Identity/session missing | No | Start approved verification |
| AUTHORIZATION_DENIED | Caller lacks scope | No | Explain limitation / handoff |
| IDENTITY_NOT_VERIFIED | Patient match insufficient | No | Verify or handoff |
| IDENTITY_AMBIGUOUS | Multiple/uncertain match | No | Handoff |
| SOURCE_UNAVAILABLE | Source system down | Yes | Explain cannot verify; retry/handoff |
| SOURCE_STALE | Data freshness outside policy | Maybe | Do not present as current |
| NOT_FOUND | Requested record absent | No | Clarify/retry |
| SLOT_NO_LONGER_AVAILABLE | Appointment slot changed | No | Find another slot |
| APPOINTMENT_NOT_MUTABLE | Backend forbids change/cancel | No | Explain / handoff |
| CONFIRMATION_REQUIRED | Commit lacks valid confirmation | No | Present summary and ask |
| CONFIRMATION_EXPIRED | Pending action expired | No | Rebuild summary |
| CONFIRMATION_MISMATCH | Token does not match payload | No | Stop; rebuild action |
| IDEMPOTENCY_CONFLICT | Same key used for different payload | No | Stop / engineering alert |
| RATE_LIMITED | Request rate exceeded | Yes | Retry later |
| PAYER_UNAVAILABLE | Eligibility source unavailable | Yes | Explain / handoff |
| POLICY_DENIED | Melinda is not permitted to perform action | No | Explain / handoff |
| HUMAN_REVIEW_REQUIRED | Automation must stop | No | Create handoff |
| INTERNAL_ERROR | Unexpected controlled failure | Maybe | Safe message + correlation ID |

## Security rule

Never return:
- SQL errors;
- stack traces;
- secrets;
- internal credentials;
- internal hostnames unless explicitly approved;
- full raw third-party payloads.

## User-safe messaging

`safe_user_message` should state what happened and the next safe option without blaming the user or exposing internals.
