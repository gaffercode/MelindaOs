export interface KredensialUploadDocument { path: string; bytes: number; contentType: string }
export interface KredensialUploadArgs { source: string; dryRun: boolean; createBucket: boolean; verify: boolean; concurrency: number }
export interface StorageTarget { origin: string; secret: string; transport?: typeof fetch }

export function parseArgs(argv: string[]): KredensialUploadArgs;
export function listDocuments(source: string): KredensialUploadDocument[];
export function createBucket(target: StorageTarget): Promise<"created" | "exists">;
export function uploadAll(documents: KredensialUploadDocument[], target: StorageTarget & { source: string; concurrency?: number }): Promise<{ uploaded: number; bytes: number; failed: Array<{ path: string; status: number }> }>;
export function verifyAll(documents: KredensialUploadDocument[], target: StorageTarget): Promise<{ matched: number; mismatched: string[]; missing: string[] }>;
