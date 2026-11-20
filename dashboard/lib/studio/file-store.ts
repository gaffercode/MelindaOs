import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join, resolve } from "node:path";
import { DirectorStoreError } from "../director/director-store";
import { packageRevisionHash } from "./assemble-package";
import type { StudioPackage } from "./contracts";
import { editableSnapshot, type StudioActor, type StudioStore } from "./store";
import { finalizationContext } from "./store";
import { checkFinalization, formatDocumentNumber, requireDirector, type FinalizationContext, type NumberSeries } from "./finalize-package";
import { DirectorApiError } from "../director/director-api";

type FileData = { packages: Record<string, StudioPackage>; history: Record<string, StudioPackage[]>; events: { packageId: string; command: string; actor: StudioActor; at: string }[]; series?: NumberSeries[] };
const queues = new Map<string, Promise<unknown>>();

/** Local, single-process development only. All instances for one file share a queue. */
export class FileStudioStore implements StudioStore {
  readonly file: string;
  constructor(private readonly directory: string, private readonly context: () => Promise<FinalizationContext> = finalizationContext) { this.file = join(resolve(directory), "packages.json"); }
  private async read(): Promise<FileData> {
    try { return JSON.parse(await readFile(this.file, "utf8")) as FileData; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return { packages: {}, history: {}, events: [] }; throw error; }
  }
  private async mutate<T>(change: (data: FileData) => T): Promise<T> {
    const previous = queues.get(this.file) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(async () => {
      const data = await this.read(); const result = change(data);
      await mkdir(this.directory, { recursive: true });
      const temp = `${this.file}.${randomUUID()}.tmp`;
      await writeFile(temp, JSON.stringify(data), "utf8"); await rename(temp, this.file);
      return structuredClone(result);
    });
    queues.set(this.file, next);
    try { return await next; } finally { if (queues.get(this.file) === next) queues.delete(this.file); }
  }
  private record(data: FileData, pkg: StudioPackage, actor: StudioActor, command: string): StudioPackage {
    data.packages[pkg.id] = pkg;
    (data.history[pkg.id] ??= []).push(structuredClone(pkg));
    data.events.push({ packageId: pkg.id, actor, command, at: new Date().toISOString() });
    return pkg;
  }
  async get(id: string): Promise<StudioPackage> {
    const result = (await this.read()).packages[id];
    if (!result) throw new DirectorStoreError(404, "not_found");
    return structuredClone(result);
  }
  async list(): Promise<StudioPackage[]> { return Object.values((await this.read()).packages); }
  create(pkg: StudioPackage, actor: StudioActor): Promise<StudioPackage> {
    return this.mutate((data) => {
      if (data.packages[pkg.id]) throw new DirectorStoreError(409, "conflict");
      const next = editableSnapshot(pkg); next.revision = 1;
      return this.record(data, next, actor, "create");
    });
  }
  save(pkg: StudioPackage, expectedRevision: number, actor: StudioActor): Promise<StudioPackage> {
    return this.mutate((data) => {
      const current = data.packages[pkg.id];
      if (!current) throw new DirectorStoreError(404, "not_found");
      if (current.revision !== expectedRevision || !["draft", "in_review"].includes(current.status)) throw new DirectorStoreError(409, "conflict");
      const next = editableSnapshot(pkg); next.revision = current.revision + 1;
      return this.record(data, next, actor, "save");
    });
  }
  review(id: string, expectedRevision: number, revisionHash: string, actor: StudioActor): Promise<StudioPackage> {
    return this.mutate((data) => {
      const current = data.packages[id];
      if (!current) throw new DirectorStoreError(404, "not_found");
      if (current.revision !== expectedRevision || !["draft", "in_review"].includes(current.status) || packageRevisionHash(current) !== revisionHash) throw new DirectorStoreError(409, "conflict");
      const next = structuredClone(current); next.revision++;
      next.status = "in_review"; next.review = { hash: revisionHash, reviewerId: actor.reviewerId, reviewedAt: new Date().toISOString() };
      return this.record(data, next, actor, "review");
    });
  }
  async finalize(id: string, expectedRevision: number, requestId: string, issueDate: string, actor: StudioActor): Promise<StudioPackage> {
    requireDirector(actor);
    const context = await this.context();
    return this.mutate((data) => {
      const current = data.packages[id];
      if (!current) throw new DirectorStoreError(404, "not_found");
      if (current.finalization?.requestId === requestId && current.finalization.issueDate === issueDate && current.snapshotHash === context.source.hash) return current;
      if (current.revision !== expectedRevision || current.status !== "in_review") throw new DirectorStoreError(409, "conflict");
      if (!requestId.trim() || requestId.length > 128) throw new DirectorApiError(422, "Identitas permintaan tidak valid.");
      checkFinalization(current, context, issueDate, actor);
      data.series ??= structuredClone(context.series);
      const next = structuredClone(current);
      for (const doc of next.documents) {
        const series = data.series.find((s) => s.id === doc.kind && s.authority === doc.authority);
        if (!series) throw new DirectorApiError(422, "Register penomoran belum tersedia.");
        doc.number = formatDocumentNumber(series, issueDate); doc.issueDate = issueDate;
        series.nextSequence = series.nextSequence! + 1;
        if (Object.values(data.packages).some((p) => p.documents.some((d) => d.number === doc.number))) throw new DirectorStoreError(409, "conflict");
      }
      next.status = "ready_for_signature"; next.revision++;
      next.issues = []; next.finalization = { requestId, issueDate, reviewHash: current.review!.hash };
      next.finalizedHash = packageRevisionHash(next);
      return this.record(data, next, actor, "finalize");
    });
  }
  async confirmSigned(id: string, expectedRevision: number, evidenceRef: string, signedAt: string, actor: StudioActor): Promise<StudioPackage> {
    requireDirector(actor);
    const context = await this.context();
    const pkg = await this.get(id);
    if (!evidenceRef.trim() || !(await context.verifyEvidenceRef?.(evidenceRef, pkg, signedAt)) || !Number.isFinite(Date.parse(signedAt)) || Date.parse(signedAt) > Date.now()) throw new DirectorApiError(422, "Bukti pengesahan belum dapat diverifikasi.");
    return this.mutate((data) => {
      const current = data.packages[id];
      if (!current) throw new DirectorStoreError(404, "not_found");
      if (current.finalizedHash !== pkg.finalizedHash) throw new DirectorStoreError(409, "conflict");
      if (current.signature?.evidenceRef === evidenceRef && current.signature.signedAt === signedAt) return current;
      if (current.revision !== expectedRevision || current.status !== "ready_for_signature") throw new DirectorStoreError(409, "conflict");
      if (signedAt.slice(0, 10) < current.finalization!.issueDate) throw new DirectorApiError(422, "Pengesahan mendahului tanggal penetapan.");
      const next = structuredClone(current); next.revision++; next.status = "signed";
      next.signature = { evidenceRef, signedAt, confirmedBy: actor.reviewerId };
      return this.record(data, next, actor, "confirm_signed");
    });
  }
}
