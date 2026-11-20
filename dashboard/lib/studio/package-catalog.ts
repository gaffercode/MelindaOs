import catalog from "../../data/studio/package-catalog.json";
import type { StudioDocument } from "./contracts";

export type PackageDefinition = { key: string; name: string; requiredFactKeys: string[]; documents: (Omit<StudioDocument, "sources"> & { sourceIds: string[] })[] };

export function packageDefinitions(): PackageDefinition[] {
  return structuredClone(catalog) as PackageDefinition[];
}

export function packageDefinition(key: string): PackageDefinition {
  const result = packageDefinitions().find((p) => p.key === key);
  if (!result) throw new Error("Paket dokumen tidak dikenal.");
  return result;
}
