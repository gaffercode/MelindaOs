import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { buildKnowledgeIndex, knowledgeChunksPath, knowledgeIndexPath, parseValidationOutput, repositoryRoot, validationFilePath } from "../lib/repository.ts";
import { buildStudioSourceSnapshot } from "../lib/studio/source-snapshot.ts";
import { serializeSearchIndex } from "../lib/ask/retrieve.ts";
import { copyDirectorQueue, directorQueuePath } from "../lib/director/director-queue.ts";

const execFileAsync = promisify(execFile);

/** Runs the real frontmatter checker and refreshes data/validation.json. Never fails the build:
 * when the checker cannot run here (e.g. missing Python deps), the committed snapshot stays. */
async function refreshValidationSnapshot(root: string): Promise<void> {
  const script = path.join(root, "tools", "governance", "validate_frontmatter.py");
  const attempts: Array<{ command: string; args: string[]; options?: { cwd: string } }> = [
    { command: "uv", args: ["run", "--no-project", "--with", "pyyaml", "--with", "jsonschema", "python", "-X", "utf8", script], options: { cwd: root } },
    { command: "python3", args: ["-X", "utf8", script], options: { cwd: root } },
  ];
  for (const attempt of attempts) {
    try {
      const { stdout } = await execFileAsync(attempt.command, attempt.args, { cwd: root, timeout: 120_000, maxBuffer: 4_000_000 });
      const snapshot = parseValidationOutput(stdout);
      if (!snapshot) {
        console.warn(`Validation snapshot: cannot parse checker output via ${attempt.command}; keeping committed snapshot.`);
        return;
      }
      await writeFile(validationFilePath(), JSON.stringify(snapshot), "utf8");
      console.log(`Validation snapshot: ${snapshot.passed}/${snapshot.total} -> ${path.relative(process.cwd(), validationFilePath())}`);
      return;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`Validation snapshot: checker via ${attempt.command} failed (${message}); trying next.`);
    }
  }
  console.warn("Validation snapshot: checker unavailable; keeping committed snapshot.");
}

const root = repositoryRoot();
const { chunks, ...index } = await buildKnowledgeIndex(root);
if (!index.documents.length) throw new Error(`No approved knowledge documents found under ${root}; set MELINDAOS_ROOT.`);
const file = knowledgeIndexPath();
await mkdir(path.dirname(file), { recursive: true });
await writeFile(file, JSON.stringify(index), "utf8");
console.log(`Knowledge index: ${index.documents.length} documents -> ${path.relative(process.cwd(), file)}`);
await writeFile(knowledgeChunksPath(), JSON.stringify(chunks), "utf8");
console.log(`Knowledge chunks: ${chunks.length} chunks -> ${path.relative(process.cwd(), knowledgeChunksPath())}`);
const searchIndexPath = path.join(path.dirname(file), "knowledge-search-index.json");
await writeFile(searchIndexPath, serializeSearchIndex(chunks), "utf8");
console.log(`Knowledge search index: ${chunks.length} chunks -> ${path.relative(process.cwd(), searchIndexPath)}`);
const studio = await buildStudioSourceSnapshot(root, new Date().toISOString().slice(0, 10));
await writeFile(path.join(path.dirname(file), "studio-source-snapshot.json"), JSON.stringify(studio), "utf8");
console.log(`Studio source snapshot: ${studio.sources.length} sources, ${studio.facts.filter((f) => f.status === "verified").length} verified facts`);
// The Director's answer page and its API read this copy; without it they answer 503 and say so.
const queueLines = await copyDirectorQueue(root);
if (queueLines === null) console.warn("Director queue: source missing or invalid; not bundled.");
else console.log(`Director queue: ${queueLines} lines -> ${path.relative(process.cwd(), directorQueuePath()).split(path.sep).join("/")}`);
await refreshValidationSnapshot(root);
