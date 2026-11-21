import { jsonResponse, rateLimit, readBoundedJson } from "../director/director-api";
import { logError } from "../log";
import { authenticateMcp, type McpAuthContext } from "./auth";
import { executeMcpTool, MCP_ICONS, MCP_LOGO_URL, MCP_TOOLS, McpToolError } from "./tools";

const MCP_PROTOCOL_VERSION = "2024-11-05";
const SERVER_INFO = {
  name: "melindaos-all-access-mcp",
  title: "MelindaOS All-Access MCP",
  version: "1.0.0",
  websiteUrl: "https://melindaos.app",
  iconUrl: MCP_LOGO_URL,
  icons: MCP_ICONS,
};
const MAX_MCP_BODY_BYTES = 512_000;
/** A batch runs its items in parallel, so its size bounds how many writes one request can fire. */
const MAX_MCP_BATCH = 10;
const MCP_CALLS_PER_MINUTE = 60;

type JsonRpcId = string | number | null;
type JsonRpcRequest = {
  jsonrpc?: unknown;
  id?: JsonRpcId;
  method?: unknown;
  params?: unknown;
};

function rpcResult(id: JsonRpcId, result: unknown) {
  return { jsonrpc: "2.0" as const, id, result };
}

function rpcError(id: JsonRpcId, code: number, message: string) {
  return { jsonrpc: "2.0" as const, id, error: { code, message } };
}

async function handleJsonRpcMessage(message: unknown, ctx: McpAuthContext) {
  if (!message || typeof message !== "object" || Array.isArray(message)) {
    return rpcError(null, -32600, "Invalid Request");
  }
  const req = message as JsonRpcRequest;
  const id: JsonRpcId = typeof req.id === "string" || typeof req.id === "number" || req.id === null ? req.id : null;
  if (req.jsonrpc !== "2.0" || typeof req.method !== "string") {
    return rpcError(id, -32600, "Invalid Request");
  }

  switch (req.method) {
    case "initialize":
      return rpcResult(id, {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: `MelindaOS All-Access MCP aktif untuk agent '${ctx.agentId}'. Seluruh tool baca dan tulis terbuka.`,
      });

    case "notifications/initialized":
      return req.id === undefined ? null : rpcResult(id, {});

    case "ping":
      return rpcResult(id, {});

    case "tools/list":
      return rpcResult(id, { tools: MCP_TOOLS });

    case "tools/call": {
      const params = req.params;
      if (!params || typeof params !== "object" || Array.isArray(params)) {
        return rpcError(id, -32602, "Invalid params");
      }
      const { name, arguments: rawArgs } = params as { name?: unknown; arguments?: unknown };
      if (typeof name !== "string" || !name.trim()) {
        return rpcError(id, -32602, "Tool name is required");
      }
      const args =
        rawArgs === undefined || rawArgs === null
          ? {}
          : typeof rawArgs === "object" && !Array.isArray(rawArgs)
            ? (rawArgs as Record<string, unknown>)
            : null;
      if (args === null) {
        return rpcError(id, -32602, "Tool arguments must be an object");
      }

      try {
        const output = await executeMcpTool(name, args, ctx);
        return rpcResult(id, {
          content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
          isError: false,
        });
      } catch (error) {
        if (error instanceof McpToolError) {
          return rpcResult(id, {
            content: [{ type: "text", text: JSON.stringify({ status: "error", message: error.message }) }],
            isError: true,
          });
        }
        logError(`mcp_tool_${name}`, error);
        return rpcResult(id, {
          content: [{ type: "text", text: JSON.stringify({ status: "error", message: "Eksekusi tool gagal." }) }],
          isError: true,
        });
      }
    }

    default:
      return rpcError(id, -32601, `Method not found: ${req.method}`);
  }
}

export async function handleMcpGet(request: Request): Promise<Response> {
  const ctx = await authenticateMcp(request);
  return jsonResponse({
    status: "ready",
    protocolVersion: MCP_PROTOCOL_VERSION,
    serverInfo: SERVER_INFO,
    iconUrl: MCP_LOGO_URL,
    capabilities: { tools: { listChanged: false } },
    agentId: ctx.agentId,
    authMode: ctx.mode,
    accessLevel: "ALL_ACCESS",
    tools: MCP_TOOLS.map((t) => t.name),
  });
}

export async function handleMcpPost(request: Request): Promise<Response> {
  const ctx = await authenticateMcp(request);
  // One shared token serves every agent, so the limit is per credential kind. File mode has no store to count in.
  if (ctx.config) await rateLimit(ctx.config, `mcp:${ctx.mode}`, MCP_CALLS_PER_MINUTE, 60);
  const body = await readBoundedJson(request, MAX_MCP_BODY_BYTES);

  if (Array.isArray(body)) {
    if (body.length === 0 || body.length > MAX_MCP_BATCH) {
      return jsonResponse(rpcError(null, -32600, "Invalid Request"), 400);
    }
    const replies = (await Promise.all(body.map((item) => handleJsonRpcMessage(item, ctx)))).filter(
      (reply): reply is NonNullable<typeof reply> => reply !== null
    );
    if (replies.length === 0) {
      return new Response(null, { status: 202, headers: { "Cache-Control": "private, no-store" } });
    }
    return jsonResponse(replies);
  }

  const reply = await handleJsonRpcMessage(body, ctx);
  if (reply === null) {
    return new Response(null, { status: 202, headers: { "Cache-Control": "private, no-store" } });
  }
  return jsonResponse(reply);
}
