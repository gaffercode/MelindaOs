export function logError(code: string, error: unknown): void {
  const name = error instanceof Error ? error.name : error === null ? "null" : typeof error === "object" ? "Object" : typeof error;
  const status = error && typeof error === "object" && "status" in error && typeof error.status === "number" ? error.status : undefined;
  // Short machine hint only for plain Error (SIWC/Responses), never for director/store errors that may hold PHI.
  const hint =
    error instanceof Error && error.name === "Error"
      ? error.message.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[email]").slice(0, 160)
      : undefined;
  console.error(JSON.stringify({
    level: "error",
    code,
    name,
    ...(status === undefined ? {} : { status }),
    ...(hint ? { hint } : {}),
  }));
}

/** One info line of a code and counts or other codes; never text written by a person or a model. */
export function logInfo(code: string, fields: Record<string, string | number | boolean>): void {
  console.info(JSON.stringify({ level: "info", code, ...fields }));
}
