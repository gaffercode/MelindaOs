export declare const BUCKET: string;
export declare const REQUIRED_FILES: readonly string[];
export declare function safePath(path: unknown): boolean;
export declare function untrackedKnowledge(ignored: readonly string[]): string[];
export declare function parseManifest(value: unknown): { release: string; files: { path: string; sha256: string; bytes: number }[] } | null;
export declare function fetchPrivateData(options?: { env?: NodeJS.ProcessEnv; transport?: typeof fetch; root?: string; concurrency?: number; log?: (line: string) => void; required?: readonly string[] }): Promise<{ skipped: boolean; files: number; release?: string }>;
