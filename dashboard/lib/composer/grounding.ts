import { createHash } from "node:crypto";
import type { Fact } from "./facts";

/** A diagnosis code (O80.0, P03.4, O82) is matched first so that its digits are skipped; any other numeral is a number, even when glued to letters. */
const TOKEN = /\b[A-Za-z]\d{2}(?:\.\d{1,2})?\b(?![.,]\d)|(?<numeral>\d+(?:[.,]\d+)*)/g;
const THOUSANDS = /^[1-9]\d{0,2}(?:\.\d{3})+$/;
const TOLERANCE = 1e-9;

/** One numeral as written in Indonesian: "1.234" is 1234 and "87,5" is 87.5. Anything that fits no format is read digit group by digit group. */
function parseNumeral(token: string): number[] {
  if (/^\d+$/.test(token)) return [Number(token)];
  if (/^\d+,\d+$/.test(token)) return [Number(token.replace(",", "."))];
  if (/^\d+\.\d+$/.test(token) && !THOUSANDS.test(token)) return [Number(token)];
  if (THOUSANDS.test(token)) return [Number(token.replaceAll(".", ""))];
  const [whole, decimals, ...rest] = token.split(",");
  if (decimals !== undefined && rest.length === 0 && /^\d+$/.test(decimals) && THOUSANDS.test(whole)) return [Number(`${whole.replaceAll(".", "")}.${decimals}`)];
  return token.split(/[.,]/).map(Number);
}

/** Every number written in `text` except diagnosis codes, as magnitudes: signs, `%`, `‰`, `Rp` and a sentence's closing dot are not part of a number. */
export function numbersIn(text: string): number[] {
  return [...text.matchAll(TOKEN)].flatMap((match) => (match.groups?.numeral === undefined ? [] : parseNumeral(match.groups.numeral)));
}

/** The numbers a brief may state: the facts' values and the numerals in their texts (labels included). */
export function allowedNumbers(facts: Fact[]): Set<number> {
  return new Set(facts.flatMap((fact) => [...fact.values, ...numbersIn(fact.text)]));
}

/** True when every number in `text` is one of `allowed`, up to floating point error. */
export function isGrounded(text: string, allowed: Set<number>): boolean {
  const known = [...allowed];
  return numbersIn(text).every((value) => known.some((candidate) => Math.abs(candidate - value) < TOLERANCE));
}

/** A short code for a decision, stable for as long as its primary fact id stays the same. */
export function decisionCode(factId: string): string {
  return `K-${createHash("sha256").update(factId).digest("hex").slice(0, 8)}`;
}
