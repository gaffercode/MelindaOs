import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { isDirectorQueue, type DirectorQueue } from "../knowledge/document-answer-rules.ts";

/** The queue file `python -m readiness --queue` writes, relative to the repository root. */
export const DIRECTOR_QUEUE_SOURCE = "knowledge/12_GOVERNANCE/knowledge/readiness-director-queue.json";

/** The copy of the Director queue file that the build bundles with the dashboard. Server only. */
export function directorQueuePath(): string {
  return join(/*turbopackIgnore: true*/ process.cwd(), "data", "director-queue.json");
}

/** Null when the file is missing, unreadable, not JSON or not a Director queue. */
export async function loadDirectorQueue(file = directorQueuePath()): Promise<DirectorQueue | null> {
  try {
    const parsed: unknown = JSON.parse(await readFile(/*turbopackIgnore: true*/ file, "utf8"));
    return isDirectorQueue(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Build step: copies the repository's queue file next to the dashboard. Returns the number of lines, or null
 * (and writes nothing) when the source is missing or not a Director queue. */
export async function copyDirectorQueue(root: string, target = directorQueuePath()): Promise<number | null> {
  const queue = await loadDirectorQueue(join(/*turbopackIgnore: true*/ root, DIRECTOR_QUEUE_SOURCE));
  if (!queue) return null;
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, JSON.stringify(queue), "utf8");
  return queue.items.length;
}
