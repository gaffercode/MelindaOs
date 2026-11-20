# Production Readiness Checklist

## Grok Bot
- [ ] Enterprise controls reviewed.
- [ ] Each trust domain has dedicated credential boundary.
- [ ] MCP allowlist configured.
- [ ] Network egress restrictions configured.
- [ ] Auto Review / approval rules narrow and tested.
- [ ] Action Recording / audit integration reviewed.

## MAAF
- [ ] TLS, authentication, rate limits, idempotency.
- [ ] Backend re-authorizes every write; MCP is not sole enforcement point.
- [ ] Secrets vault access uses workload identity/AppRole with least privilege.
- [ ] Token refresh job tested including revoked-token path.
- [ ] No secrets in logs.
- [ ] Provider API rate-limit and retry semantics implemented.
- [ ] API version deprecation watch enabled.

## Social / External communications
- [ ] Brand/tone policy loaded.
- [ ] Clinical/medical claims require evidence + AEGIS/GUARDIAN validation.
- [ ] Pre-approved content classes explicitly defined.
- [ ] Crisis content requires human authority.
- [ ] Delete/correction workflow tested.

## Clinical data
- [ ] DPIA/privacy/legal review completed before patient-level integration.
- [ ] Data minimization and de-identification documented.
- [ ] Source-of-truth/freshness metadata preserved.
- [ ] L5 hard stop tested.

## Automation Above All
- [ ] Every manual step has documented reason why it cannot yet be automated.
- [ ] Every auth integration has refresh/recovery path.
- [ ] Human escalation occurs only after recovery or policy hard-stop.
