// Bundled copy of knowledge/11_MACHINE_READABLE/starkes/starkes-kelulusan-2024.json: files outside dashboard/ are not traced
// into the Vercel function. tests/starkes-kelulusan-copy.test.ts keeps the copy identical to the source.
import kelulusan from "../../data/starkes/kelulusan-2024.json";
import type { Kelulusan } from "./kelulusan-rules";

export { chapterPassMark, type Kelulusan } from "./kelulusan-rules";

export async function loadKelulusan(): Promise<Kelulusan> {
  // JSON imports widen tuples to number[]; parse a fresh copy as the earlier file reader did.
  return JSON.parse(JSON.stringify(kelulusan)) as Kelulusan;
}
