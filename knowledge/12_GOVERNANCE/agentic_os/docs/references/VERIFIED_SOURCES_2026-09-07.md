# Verified technology references — 7 September 2026

Dokumen ini mencatat source-of-truth yang harus diverifikasi ulang saat deployment karena API, scopes, entitlements, dan product controls dapat berubah.

## Grok Bot / xAI
- https://docs.x.ai/grok-bot/overview — persistent Bot, connectors/MCP, computer use, multi-Bot collaboration.
- https://docs.x.ai/grok-bot/security-faq — shared computer per user, credential boundary, Enterprise controls.
- https://docs.x.ai/grok-bot/skills-routines-and-automations — skills/routines and background automation.
- https://docs.x.ai/grok-bot/teams-and-enterprises — MCP allowlist, network controls, audit/action recording and Enterprise administration.
- https://docs.x.ai/grok/connectors — custom MCP connector and internal API/SaaS exposure.

## Meta
- https://developers.facebook.com/documentation/instagram-platform/content-publishing
- https://developers.facebook.com/documentation/instagram-platform/reference/refresh_access_token
- https://developers.facebook.com/documentation/threads/get-started
- https://developers.facebook.com/documentation/threads/get-started/long-lived-tokens

## LinkedIn
- https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api?view=li-lms-2026-08
- https://learn.microsoft.com/en-us/linkedin/shared/authentication/programmatic-refresh-tokens
- https://learn.microsoft.com/en-us/linkedin/shared/authentication/authorization-code-flow

## YouTube
- https://developers.google.com/youtube/v3/guides/auth/server-side-web-apps

## X
- https://docs.x.com/fundamentals/authentication/oauth-2-0/authorization-code
- https://docs.x.com/x-api/posts/manage-tweets/quickstart

## MCP SDK
- https://github.com/modelcontextprotocol/python-sdk — v2 current stable line in September 2026; `MCPServer` replaces v1 `FastMCP`.

## Orchestration / secrets
- https://docs.temporal.io/
- https://docs.n8n.io/hosting/securing/security-audit/
- https://developer.hashicorp.com/vault/docs/auth/approle

## Rule
Setiap implementasi provider harus mengunci versi API yang masih supported pada tanggal go-live dan mempunyai automated deprecation/sunset watch.
