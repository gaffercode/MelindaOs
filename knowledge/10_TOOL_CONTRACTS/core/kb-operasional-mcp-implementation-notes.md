---
doc_id: "SOP-OPS-MCP-IMPLEMENTATION-NOTES"
title: "MCP Implementation Notes"
domain: "Operasional"
department: "Unit IT"
version: "1.0"
last_reviewed: "2026-09-28"
ftdr_safety_override: false
tags: ["operasional", "unit-it", "core", "mcp-implementation-notes"]
governance:
  status: "APPROVED"
  validation_level: "CANONICAL"
  validated_by: "dr. Ferdi Andriska, S.H., M.Kn., CMDC"
  role: "Director in Command"
  date_enacted: "2026-09-28"
  enforcement: "Strict / Mandatory"
---

# MCP Implementation Notes

## Baseline

Target **MCP specification 2026-07-28** for a new production implementation unless the chosen host requires an earlier compatibility mode.

The 2026-07-28 MCP release uses a stateless protocol core and supports full JSON Schema 2020-12 for tool input/output schemas. This makes the protocol suitable for typed, cacheable tool catalogs and ordinary HTTP infrastructure.

## Server

Recommended logical server name:

```text
melinda-hospital-mcp
```

Recommended versioning:
- protocol/server implementation version;
- tool semantic version;
- schema version;
- backend adapter version independently tracked.

## Tool naming

Use stable dotted business names:
- `doctor.get_schedule`
- `appointment.create`

Do not encode vendor names into public tool names.

## Schemas

- Root input must be an object.
- Set `additionalProperties: false` unless a deliberate extensibility case exists.
- Use enumerations for business states.
- Use ISO 8601/RFC 3339 date-time strings.
- Use hospital-local timezone explicitly for schedule results.
- Use opaque IDs.
- Validate inputs twice when practical: MCP schema validation + business/domain validation.

## OpenAI function/tool behavior

Where a tool is also exposed through OpenAI function calling, use strict structured schemas where supported. Schema conformance does not replace:
- authentication;
- authorization;
- confirmation;
- idempotency;
- rate limits;
- backend validation.

## Risk annotations

MCP tool annotations can help clients understand read-only/destructive/idempotent behavior, but treat them as metadata hints. Enforcement must live in the server/policy layer.

Suggested annotation intent:
- read-only tools: `readOnlyHint: true`
- mutation tools: `readOnlyHint: false`
- cancellation: destructive/consequential
- idempotent mutation semantics should be declared where the client/schema supports it

## Transport / deployment

For remote production:
- TLS only;
- authenticated service access;
- short-lived credentials;
- load balancer/API gateway;
- stateless MCP request handling where supported;
- centralized policy/audit;
- per-environment endpoints and credentials;
- no production secrets in prompts or repository samples.

## Long-running workflows

Do not turn ordinary front-office calls into long-running tasks unnecessarily. If a future workflow genuinely requires asynchronous/long-running execution, isolate it behind a task/job abstraction and return a status reference.

## Compatibility

If ChatGPT/another host exposes only a subset of MCP behavior:
1. preserve the same business tool names;
2. adapt transport/schema at the edge;
3. keep server-side policy and audit unchanged;
4. never weaken confirmation or authorization for compatibility.
