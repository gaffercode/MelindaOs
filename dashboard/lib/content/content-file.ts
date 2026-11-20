// Hospital-specific wording (management tasks, forum schedule, document presets, brief and news copy) lives in
// dashboard/data/content/*.json, not in code. The repository holds fictional files; the production build replaces them
// with the hospital's real files from private storage (dashboard/scripts/fetch-private-data.mjs). These helpers check
// a content file's shape when the module loads, so a broken file fails the build instead of a page.

export class ContentFileError extends Error {
  constructor(file: string, problem: string) {
    super(`dashboard/data/content/${file}: ${problem}`);
    this.name = "ContentFileError";
  }
}

type Check = (value: unknown) => boolean;

export const isString: Check = (value) => typeof value === "string";
export const isStringArray: Check = (value) => Array.isArray(value) && value.every(isString);
export const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
export const oneOf = (allowed: readonly string[]): Check => (value) => typeof value === "string" && allowed.includes(value);
export const arrayOf = (check: Check): Check => (value) => Array.isArray(value) && value.every(check);

/** Throws unless every listed field passes its check. Optional fields may be absent. */
export function requireFields(
  file: string,
  where: string,
  value: unknown,
  required: Record<string, Check>,
  optional: Record<string, Check> = {},
): void {
  if (!isObject(value)) throw new ContentFileError(file, `${where} is not an object.`);
  for (const [key, check] of Object.entries(required)) {
    if (!check(value[key])) throw new ContentFileError(file, `${where}.${key} is missing or malformed.`);
  }
  for (const [key, check] of Object.entries(optional)) {
    if (key in value && !check(value[key])) throw new ContentFileError(file, `${where}.${key} is malformed.`);
  }
}

/** Fills {name} placeholders. A placeholder without a value is a content bug and throws. */
export function fill(template: string, values: Readonly<Record<string, string | number>>): string {
  return template.replace(/\{([A-Za-z][A-Za-z0-9]*)\}/g, (match, name: string) => {
    if (!(name in values)) throw new Error(`No value for placeholder ${match}.`);
    return String(values[name]);
  });
}
