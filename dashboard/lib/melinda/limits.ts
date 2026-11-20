export const MELINDA_MODEL = "claude-sonnet-5-5";
export const MELINDA_MAX_OUTPUT_TOKENS = 16000;
export const MELINDA_MAX_TOOL_ROUNDS = 5;
export const MELINDA_HISTORY_MESSAGES = 20;
export const MELINDA_MAX_MESSAGE = 2000;
export const MELINDA_DAILY_TOKEN_LIMIT = 500_000;
export const MELINDA_RATE_LIMIT = 30;
export const MELINDA_RATE_WINDOW_SECONDS = 600;
export const MELINDA_ROUND_TIMEOUT_MS = 120_000;
/** Under the chat route's `maxDuration = 300`, so a long turn ends in words rather than being cut off by the platform. */
export const MELINDA_TURN_DEADLINE_MS = 270_000;

export const MELINDA_GREETING = "Selamat datang, Pak Direktur";
export const MELINDA_UNAVAILABLE = "Melinda sedang tidak tersedia.";

export const melindaModel = () => process.env.MELINDAOS_MELINDA_MODEL?.trim() || MELINDA_MODEL;
