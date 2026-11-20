import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import type { SourceRef } from "./contracts";

export type InstitutionFact = { key: string; value: string; sourceIds: string[]; status: "verified" | "conflict" | "missing"; effectiveFrom: string | null; effectiveUntil: string | null; usage: "static" | "historical" | "requires_current_evidence" };
export type SourceSnapshot = { hash: string; sources: SourceRef[]; facts: InstitutionFact[] };
const digest = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const allowedRoots = new Set(["00_INDEX", "01_HOSPITAL", "06_CLINICAL_SAFETY", "07_LEGAL_REGULATORY", "11_MACHINE_READABLE"]);

/** A source locator is an exact heading; only that heading's section is used for fact validation. */
function sectionAt(content: string, locator: string): string | null {
  const lines = content.split(/\r?\n/);
  const index = lines.findIndex((line) => /^#{1,6}\s/.test(line) && line.replace(/^#{1,6}\s+/, "").trim() === locator);
  if (index < 0) return null;
  const level = lines[index].match(/^#+/)![0].length;
  let end = index + 1;
  while (end < lines.length && !(new RegExp(`^#{1,${level}}\\s`).test(lines[end]))) end++;
  return lines.slice(index, end).join("\n");
}

async function sourcePath(root: string, path: string): Promise<string> {
  const parts = path.replaceAll("\\", "/").split("/");
  if (isAbsolute(path) || parts.some((part) => ["..", ".git", "sources", "99_ARCHIVE", ".env", ".claude", "patient_records"].includes(part)) || parts[0] !== "knowledge" || !allowedRoots.has(parts[1]) || !path.endsWith(".md")) throw new Error("Sumber di luar cakupan Studio.");
  const target = await realpath(resolve(root, path));
  const rel = relative(root, target);
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error("Sumber di luar cakupan Studio.");
  return target;
}

export async function buildStudioSourceSnapshot(root: string, asOf: string): Promise<SourceSnapshot> {
  const rootReal = await realpath(root);
  const config = join(rootReal, "dashboard", "data", "studio");
  const definitions = JSON.parse(await readFile(join(config, "sources.json"), "utf8")) as Omit<SourceRef, "sha256">[];
  const facts = JSON.parse(await readFile(join(config, "facts.json"), "utf8")) as InstitutionFact[];
  const sections = new Map<string, string>();
  const sources: SourceRef[] = [];
  for (const entry of definitions) {
    const bytes = await readFile(await sourcePath(rootReal, entry.path));
    const text = sectionAt(bytes.toString("utf8"), entry.locator);
    const unresolved = !text || /\[\s*(?:ISI|CEK)\b|\bdraf(?:t)?\b|belum disahkan|belum diangkat/i.test(text);
    sources.push({ ...entry, sha256: digest(bytes), status: unresolved ? "unresolved" : entry.status });
    if (text) sections.set(entry.id, text);
  }
  for (const fact of facts) {
    fact.effectiveFrom ??= null; fact.effectiveUntil ??= null;
    const expired = (fact.effectiveUntil !== null && fact.effectiveUntil < asOf) || (fact.effectiveFrom !== null && fact.effectiveFrom > asOf);
    const supported = fact.sourceIds.length > 0 && fact.sourceIds.every((id) => sources.some((s) => s.id === id && s.status === "verified")) && fact.sourceIds.some((id) => sections.get(id)?.includes(fact.value));
    if (!supported || expired || fact.usage === "historical") fact.status = "missing";
  }
  for (const fact of facts) {
    if (new Set(facts.filter((f) => f.key === fact.key).map((f) => f.value)).size > 1) fact.status = "conflict";
  }
  const payload = { sources, facts };
  return { hash: digest(JSON.stringify(payload)), ...payload };
}

export async function loadStudioSourceSnapshot(): Promise<SourceSnapshot> {
  const file = process.env.MELINDAOS_STUDIO_SNAPSHOT || join(process.cwd(), "data", "studio-source-snapshot.json");
  const snapshot = JSON.parse(await readFile(/*turbopackIgnore: true*/ file, "utf8")) as SourceSnapshot;
  if (!Array.isArray(snapshot.sources) || !Array.isArray(snapshot.facts) || digest(JSON.stringify({ sources: snapshot.sources, facts: snapshot.facts })) !== snapshot.hash) throw new Error("Snapshot sumber Studio tidak valid.");
  return snapshot;
}
