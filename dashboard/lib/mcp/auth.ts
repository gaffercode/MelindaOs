import { timingSafeEqual } from "node:crypto";
import { DirectorApiError, requireHuman } from "../director/director-api";
import {
  authConfiguration,
  cookieSession,
  hashSecret,
  protectedDirectorMode,
  type DirectorAuthConfiguration,
} from "../director/director-auth";

/** Every MCP caller shares one identity; agent names are not distinguished. */
export const SHARED_AGENT_ID = "ALL_ACCESS";

export type McpAuthMode = "file" | "master_token" | "director_session";

export type McpAuthContext = {
  agentId: string;
  mode: McpAuthMode;
  config: DirectorAuthConfiguration | null;
};

function equalHex(left: string, right: string): boolean {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

function configuredTokenHash(): string | null {
  const rawHash = process.env.MELINDAOS_MCP_TOKEN_HASH?.trim().toLowerCase() ?? "";
  if (/^[a-f0-9]{64}$/.test(rawHash)) return rawHash;
  const rawToken = process.env.MELINDAOS_MCP_TOKEN?.trim() ?? "";
  if (rawToken.length > 0) return hashSecret(rawToken);
  return null;
}

function safeAuthConfig(): DirectorAuthConfiguration | null {
  try {
    return authConfiguration();
  } catch {
    return null;
  }
}

export async function authenticateMcp(request: Request): Promise<McpAuthContext> {
  const agentId = SHARED_AGENT_ID;
  const expectedHash = configuredTokenHash();
  const authorization = request.headers.get("Authorization");

  if (authorization !== null) {
    if (!authorization.startsWith("Bearer ") || authorization.length > 512) {
      throw new DirectorApiError(401, "Header Authorization Bearer tidak valid.");
    }
    const supplied = authorization.slice(7).trim();
    if (!supplied) {
      throw new DirectorApiError(401, "Token MCP kosong.");
    }
    if (expectedHash) {
      if (!equalHex(hashSecret(supplied), expectedHash)) {
        throw new DirectorApiError(401, "Token MCP tidak valid.");
      }
      return { agentId, mode: "master_token", config: safeAuthConfig() };
    }
    if (!protectedDirectorMode()) {
      return { agentId, mode: "file", config: safeAuthConfig() };
    }
    throw new DirectorApiError(401, "Token MCP belum dikonfigurasi di server.");
  }

  if (!protectedDirectorMode()) {
    return { agentId, mode: "file", config: safeAuthConfig() };
  }

  if (cookieSession(request)) {
    const human = await requireHuman(request);
    return { agentId, mode: "director_session", config: human.config };
  }

  throw new DirectorApiError(401, "Token MCP tidak valid atau belum disertakan.");
}
