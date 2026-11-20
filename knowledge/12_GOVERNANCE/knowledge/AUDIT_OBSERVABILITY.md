# AUDIT & OBSERVABILITY

## 1. Audit is automatic

Audit is not exposed as a model-callable tool. The MCP gateway/server records events automatically.

## 2. Minimum audit event

```json
{
  "event_id": "uuid",
  "timestamp": "RFC3339",
  "environment": "production",
  "tool_name": "appointment.create",
  "tool_version": "1.0",
  "request_correlation_id": "opaque",
  "actor_type": "patient|visitor|staff|system",
  "actor_ref": "opaque_or_masked",
  "subject_ref": "opaque_or_masked",
  "authorization_result": "allowed|denied",
  "confirmation_id": "opaque_or_null",
  "result": "success|failure|denied",
  "error_code": "optional",
  "source_system": "appointment_system",
  "latency_ms": 123
}
```

Do not put full patient messages, raw national IDs, credentials, or unrelated clinical data into audit logs.

## 3. Observability

Track at minimum:
- tool call count;
- success rate;
- error rate by code;
- p50/p95 latency;
- source-system availability;
- stale-data rate;
- denied authorization count;
- confirmation mismatch/expiry count;
- duplicate/idempotent retry count;
- handoff rate;
- appointment mutation success rate;
- notification acceptance/failure rate.

## 4. Alerts

Production alerts should cover:
- sustained source outage;
- appointment duplicate anomalies;
- abnormal authorization failures;
- confirmation bypass attempts;
- sudden rise in internal errors;
- stale schedule/tariff source;
- notification provider failures;
- audit pipeline failure.

## 5. Traceability

Every user-visible operational result should carry a correlation ID internally so support staff can trace:
conversation -> model/tool request -> policy decision -> source call -> result.

## 6. Privacy

Use masking and opaque references. Define retention by legal/organizational policy. Logs are not a secondary patient database.
