export function migrationNames(dir?: string): string[];
export function report(names: string[], versions: string[]): { recorded: string[]; missing: string[] };
export function ledgerVersions(answer: unknown): string[] | null;
