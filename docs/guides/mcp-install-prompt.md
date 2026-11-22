# MCP install and access prompts

Copy-paste prompts for an agent (Claude Code, Codex, etc.) running on a machine with a MelindaOS checkout.
Env names, paths and tools were read from the code on 2026-11-20.

| Server | Code | Transport | Purpose |
|---|---|---|---|
| Dashboard All-Access | `dashboard/app/api/mcp/route.ts`, `dashboard/lib/mcp/` | HTTP JSON-RPC at `/api/mcp` | 20 dashboard tools (documents, schedules, Task Vault, Morning Brief, Warta, Medify, clinical handover, roster and incidents) |
| Agent All-Access (Python) | `runtime/src/melinda_agent_mcp/server.py` | stdio (default) or Streamable HTTP | knowledge base, repo file reads, bridge to dashboard and MAAF |
| MAAF | `runtime/src/melinda_maaf/mcp_server.py` | Streamable HTTP at `/mcp` | 13 hospital tools behind the risk gateway (L1–L5) |

## Prompt 1 — Local Claude Code install (stdio, simplest)

For Claude Code no prompt is needed: the committed `.mcp.json` registers `melindaos-agent` (stdio, relative path) and `melindaos-dashboard` (HTTP, token from env). Open Claude Code at the capsule root, approve the server once, and run `uv sync` if the venv is missing. Use the prompt below for another client or a custom setup.

```text
Install the MelindaOS "melindaos-agent" MCP server for Claude Code on this machine.

Context:
- Repo root: <PATH_TO_MELINDAOS> (the folder holding pyproject.toml and runtime/)
- Server: runtime/src/melinda_agent_mcp/server.py, entry point main(), stdio by default.
- Python deps are in pyproject.toml (mcp>=2,<3, PyYAML). Use uv.

Steps:
1. Run `uv sync` at the repo root. Add no new dependencies.
2. Check the import:
   uv run --directory <PATH_TO_MELINDAOS> python -c "import sys; sys.path.insert(0,'runtime/src'); import melinda_agent_mcp; print('ok')"
3. Register it with project scope (writes .mcp.json at the repo root):
   claude mcp add melindaos-agent --scope project \
     --env PYTHONPATH=runtime/src \
     --env MELINDAOS_ROOT=<PATH_TO_MELINDAOS> \
     --env MELINDA_AGENT_MCP_TRANSPORT=stdio \
     -- uv run --directory <PATH_TO_MELINDAOS> python -m melinda_agent_mcp.server
4. Optional, for dashboard_mcp_call: add --env MELINDAOS_DASHBOARD_URL=<DASHBOARD_URL>
   (e.g. http://localhost:3000). The dashboard token goes in env MELINDAOS_MCP_TOKEN,
   set by a human, never written to a committed file.
5. Optional, restrict tools: --env MELINDA_AGENT_MCP_TOOL_ALLOWLIST=agent_overview,knowledge_search,knowledge_get
   (empty or "*" enables every tool, including knowledge_write).
6. Verify: `claude mcp list` shows melindaos-agent as connected; call agent_overview and report the result.

Rules:
- Never print, log or commit any token.
- Do not commit .mcp.json until I approve it.
- Report every command with its exit code.
```

Tools: `agent_overview`, `knowledge_list`, `knowledge_search`, `knowledge_get`, `knowledge_write`, `files_list`, `file_read`, `dashboard_mcp_call`, `maaf_call`.

## Prompt 2 — Dashboard MCP (`/api/mcp`) over HTTP

```text
Connect an MCP client to the MelindaOS dashboard MCP.

Context:
- Endpoint: <BASE_URL>/api/mcp (local: http://localhost:3000/api/mcp after `pnpm --dir dashboard dev`)
- JSON-RPC 2.0: initialize, notifications/initialized, ping, tools/list, tools/call. GET returns discovery info.
- Auth (dashboard/lib/mcp/auth.ts):
  * Production, Vercel, or MELINDAOS_DIRECTOR_STORE other than "file": requires
    `Authorization: Bearer <TOKEN>` matching server env MELINDAOS_MCP_TOKEN or its SHA-256 in
    MELINDAOS_MCP_TOKEN_HASH. Without a token only a Director login cookie is accepted.
  * Local file mode (MELINDAOS_DIRECTOR_STORE unset): no token needed.
  * Every caller runs as the one shared agent identity ALL_ACCESS; no agent header is needed.

Steps:
1. Ask me to put the token in shell env MELINDAOS_MCP_TOKEN (do not ask me to paste it in chat).
2. Register it:
   claude mcp add --transport http melindaos-dashboard <BASE_URL>/api/mcp \
     --header "Authorization: Bearer ${MELINDAOS_MCP_TOKEN}"
3. Verify tools/list returns 20 tools, including agent_overview, cari_dokumen, baca_dokumen,
   baca_jadwal, baca_task_vault, baca_morning_brief, baca_warta, baca_medify, baca_handover, baca_roster, baca_insiden.
4. Call agent_overview and report the result.

Rules:
- Write tools (simpan_jadwal, ubah_status_tugas, buat_arahan, terbitkan_morning_brief,
  terbitkan_warta, sinkronkan_halaman) change real data. Do not call them without my approval.
- Never print the token or save it to a committed file.
```

Server side (operator): set `MELINDAOS_MCP_TOKEN_HASH` (safer than the raw token) in the dashboard env; see `dashboard/.env.example` lines 68–70. Production (`https://melindaos.app/api/mcp`) holds only the hash; the token was rotated on 2026-11-20.

Client side (this laptop): the raw token lives only in the Windows user env `MELINDAOS_MCP_TOKEN`. The committed `.mcp.json` already registers `melindaos-dashboard` and passes the token by `${MELINDAOS_MCP_TOKEN:-}`, so Claude Code opened at the capsule root needs no prompt. For an agent on another machine, give it the token through its own env or secret store, never in chat or a file.

## Prompt 3 — Run the MAAF MCP (HTTP, operators only)

```text
Run the MelindaOS MAAF MCP server for one trust domain.

Context: runtime/src/melinda_maaf/mcp_server.py, ASGI `app`, endpoint /mcp.
Official guide: knowledge/10_TOOL_CONTRACTS/mcp/kb-operasional-mcp-readme.md.

Env (set by the operator):
- MAAF_ACTOR_ROLE      ALL_ACCESS, the only recognized role (never chosen by the model)
- MAAF_TOOL_ALLOWLIST  exact tool list, comma-separated; empty enables no tools
- Inbound auth, one of:
  * MELINDA_AGENT_MCP_BEARER_MAP_FILE  JSON {producer_id: sha256_hex}
  * MELINDAOS_MCP_TOKEN_HASH / MELINDAOS_MCP_TOKEN  one master token
  * MAAF_MCP_BEARER_FILE  file holding the bearer token
- MAAF_BACKEND_URL     target backend; without it requests stop in local mode

Commands:
  uv sync
  uv run uvicorn --app-dir runtime/src melinda_maaf.mcp_server:app --host 127.0.0.1 --port 8000

Client access: `Authorization: Bearer <TOKEN>` to http://127.0.0.1:8000/mcp.

Rules:
- L4 tools need human approval and L5 (emergency_red_flag_check) is human-only, but only while
  MAAF_ALL_ACCESS and MELINDAOS_MCP_ALL_ACCESS are unset: all-access mode allows every risk class.
- Bind to 127.0.0.1 unless I approve public HTTPS exposure.
- Do not change allowed_roles in tool-contracts.yaml without my approval.
```

## Security checks

- **Tokenless mode is local-only.** The dashboard accepts tokenless calls in file mode, and the Python agent server uses `allow_tokenless=True`. Never expose either to a network without a token.
- **Store the hash, not the raw token**, on servers (`MELINDAOS_MCP_TOKEN_HASH`).
- **Keep credentials separate**: the inbound MCP token is not the backend credential (`MAAF_GATEWAY_BEARER_FILE`).
- **Clinical tools**: `baca_handover`, `baca_roster` and `baca_insiden` return patient names and record numbers typed on `/klinis`. Every MCP caller shares one identity, so whoever holds the token can read them; keep the token with the Director. Each read writes one row to `melinda_private.clinical_reads`, and the read fails if that row cannot be written.
- **Patient data**: `satusehat_patient_lookup` takes a NIK. Enable it only via the allowlist for an approved role.
