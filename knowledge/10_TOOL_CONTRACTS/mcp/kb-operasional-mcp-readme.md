---
doc_id: "SOP-OPS-MCP-README"
title: "Melinda MCP Gateway"
domain: "Operasional"
department: "Unit IT"
version: "1.0"
last_reviewed: "2026-09-28"
ftdr_safety_override: false
tags: ["operasional", "unit-it", "mcp", "mcp-readme"]
governance:
  status: "APPROVED"
  validation_level: "CANONICAL"
  validated_by: "dr. Ferdi Andriska, S.H., M.Kn., CMDC"
  role: "Director in Command"
  date_enacted: "2026-09-28"
  enforcement: "Strict / Mandatory"
---

# Melinda MCP Gateway

Klien agent mengakses MAAF melalui **Custom MCP Connector**. MCP server production harus tersedia melalui HTTPS dan, untuk custom connector, dapat dijangkau dari internet atau melalui enterprise networking yang didukung.

## Deployment

```bash
uv sync
export MAAF_BACKEND_URL=https://maaf-api.melinda.co.id
export MAAF_ACTOR_ROLE=ALL_ACCESS
export MAAF_MCP_BEARER_FILE=/run/secrets/maaf_mcp_bearer
export MAAF_TOOL_ALLOWLIST=melinda.finance.summary,melinda.claims.exceptions
uvicorn melinda_maaf.mcp_server:app --host 0.0.0.0 --port 8000
```

MCP endpoint: `/mcp`.

## Security boundary
- Every HTTP MCP request requires `Authorization: Bearer ...` matching the
  operator-provisioned `MAAF_MCP_BEARER_FILE`. If the file is missing/unreadable,
  the server returns 503; missing, invalid, or duplicate authorization headers return
  401. The inbound MCP credential is separate from `MAAF_GATEWAY_BEARER_FILE`.
- Each endpoint requires `MAAF_ACTOR_ROLE=ALL_ACCESS` (the only recognized role) and an exact
  `MAAF_TOOL_ALLOWLIST`. An empty allowlist enables no tools. Use one endpoint and
  credential per trust domain; the role is bound by deployment configuration, never
  by model-supplied arguments.
- All MCP tools pass through the local authorization gateway. L4 requires human
  approval and L5 is human-only. The red-flag tool therefore does not perform an
  autonomous clinical assessment through MCP.
- Every tool contract must declare an explicit `allowed_roles` list. Missing or
  malformed grants deny dispatch; an empty list grants access to no actor. Current
  lists remain empty until the owner approves exact actor/tool pairs.
- Deploy **satu MCP endpoint per trust domain** atau bind actor identity melalui workload identity.
- Jangan memberikan `actor_role`, `preapproved`, token, atau credential sebagai parameter yang dapat dipilih model.
- `MAAF_PREAPPROVED_L3` hanya diubah oleh operator/policy deployment.
- Backend wajib mengulang authorization check, melakukan idempotency, audit, retry, dan provider scope validation.

## Klien agent setup once
1. Admin menambahkan Custom MCP connector ke organisasi.
2. Masukkan HTTPS URL endpoint trust domain.
3. Lengkapi authentication yang diwajibkan gateway.
4. Pada Enterprise, masukkan MCP server ke allowlist dan batasi egress/network destination.
5. Uji tools L0 dahulu, kemudian L2, baru L3 pre-approved classes.
