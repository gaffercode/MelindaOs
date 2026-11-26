import { timingSafeEqual } from "node:crypto";
import { DirectorApiError, requireHuman } from "../director/director-api";
import {
  authConfiguration,
  cookieSession,
  hashSecret,
  protectedDirectorMode,
  type DirectorAuthConfiguration,
} from "../director/director-auth";
import { logInfo } from "../log";

/** Every MCP caller shares one identity for permissions; `credential` only says which token was used. */
export const SHARED_AGENT_ID = "ALL_ACCESS";

export type McpAuthMode = "file" | "master_token" | "director_session";

export type McpAuthContext = {
  agentId: string;
  mode: McpAuthMode;
  /**
   * Which credential opened the request: a bot name from MELINDAOS_MCP_TOKEN_HASHES, "shared" for the
   * legacy MELINDAOS_MCP_TOKEN(_HASH), "director" for the login cookie, "local" for file mode.
   * Used for logs, rate limits and audit rows; never for permissions.
   */
  credential: string;
  config: DirectorAuthConfiguration | null;
};

/** Credential names the server assigns itself; a bot entry may not take them. */
const RESERVED_CREDENTIALS = new Set(["shared", "director", "local"]);
const CREDENTIAL_NAME = /^[a-z0-9][a-z0-9-]{0,31}$/;
const SHA256_HEX = /^[a-f0-9]{64}$/;
const CONFIG_INVALID = "Konfigurasi token MCP di server tidak valid.";

type CredentialHash = { name: string; hash: string };

function equalHex(left: string, right: string): boolean {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

function legacyTokenHash(): string | null {
  const rawHash = process.env.MELINDAOS_MCP_TOKEN_HASH?.trim().toLowerCase() ?? "";
  if (SHA256_HEX.test(rawHash)) return rawHash;
  const rawToken = process.env.MELINDAOS_MCP_TOKEN?.trim() ?? "";
  if (rawToken.length > 0) return hashSecret(rawToken);
  return null;
}

/**
 * MELINDAOS_MCP_TOKEN_HASHES holds one entry per bot: `name=sha256hex`, comma-separated.
 * Any malformed entry makes the whole setting invalid (fail closed), so a typo never silently
 * locks one bot out while the others keep working.
 */
function botTokenHashes(): CredentialHash[] {
  const raw = process.env.MELINDAOS_MCP_TOKEN_HASHES ?? "";
  const entries: CredentialHash[] = [];
  const names = new Set<string>();
  const hashes = new Set<string>();
  for (const part of raw.split(",")) {
    const item = part.trim();
    if (!item) continue;
    const separator = item.indexOf("=");
    const name = separator < 0 ? "" : item.slice(0, separator).trim();
    const hash = separator < 0 ? "" : item.slice(separator + 1).trim().toLowerCase();
    if (!CREDENTIAL_NAME.test(name) || RESERVED_CREDENTIALS.has(name) || !SHA256_HEX.test(hash) || names.has(name) || hashes.has(hash)) {
      logInfo("mcp_auth_config_invalid", { entry: entries.length + 1 });
      throw new DirectorApiError(503, CONFIG_INVALID);
    }
    names.add(name);
    hashes.add(hash);
    entries.push({ name, hash });
  }
  return entries;
}

function configuredCredentials(): CredentialHash[] {
  const credentials = botTokenHashes();
  const legacy = legacyTokenHash();
  if (legacy) credentials.push({ name: "shared", hash: legacy });
  return credentials;
}

/** First 8 hex of the token's SHA-256: enough to tell a stale token apart, useless for guessing it. */
function rejectAuth(reason: string, message: string, supplied?: string): never {
  logInfo("mcp_auth_rejected", supplied ? { reason, fingerprint: hashSecret(supplied).slice(0, 8) } : { reason });
  throw new DirectorApiError(401, message);
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
  const credentials = configuredCredentials();
  const authorization = request.headers.get("Authorization");

  if (authorization !== null) {
    // `Bearer ${TOKEN}` with an unset TOKEN arrives as a bare "Bearer" (header values are trimmed):
    // report it as an empty token, which is what it is, not as a malformed header.
    if (/^bearer$/i.test(authorization.trim())) {
      rejectAuth("empty", "Token MCP kosong.");
    }
    if (!authorization.startsWith("Bearer ") || authorization.length > 512) {
      rejectAuth("format", "Header Authorization Bearer tidak valid.");
    }
    const supplied = authorization.slice(7).trim();
    if (!supplied) {
      rejectAuth("empty", "Token MCP kosong.");
    }
    if (credentials.length > 0) {
      const suppliedHash = hashSecret(supplied);
      let matched: string | null = null;
      // Compare against every entry so the response time does not reveal a position.
      for (const credential of credentials) {
        if (equalHex(suppliedHash, credential.hash)) matched = credential.name;
      }
      if (matched === null) rejectAuth("mismatch", "Token MCP tidak valid.", supplied);
      logInfo("mcp_auth_ok", { credential: matched });
      return { agentId, mode: "master_token", credential: matched, config: safeAuthConfig() };
    }
    if (!protectedDirectorMode()) {
      return { agentId, mode: "file", credential: "local", config: safeAuthConfig() };
    }
    throw new DirectorApiError(401, "Token MCP belum dikonfigurasi di server.");
  }

  if (!protectedDirectorMode()) {
    return { agentId, mode: "file", credential: "local", config: safeAuthConfig() };
  }

  if (cookieSession(request)) {
    const human = await requireHuman(request);
    return { agentId, mode: "director_session", credential: "director", config: human.config };
  }

  rejectAuth("missing", "Token MCP tidak valid atau belum disertakan.");
}
