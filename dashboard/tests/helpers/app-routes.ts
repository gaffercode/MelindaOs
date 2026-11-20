import { readdirSync } from "node:fs";
import path from "node:path";
import { secondaryViews } from "@/lib/navigation";

export const APP = path.resolve(__dirname, "../../app");

/** Pages that are meant to open without a Director session. Adding one here is a security decision. */
export const PUBLIC_PAGES = ["/director-login", "/laporan-unit", "/rujukan"];

/** Every file called `name` under `app/`, as a sorted path relative to it. */
export const files = (name: string) => readdirSync(APP, { recursive: true, encoding: "utf8" }).map((file) => file.replaceAll("\\", "/")).filter((file) => file === name || file.endsWith(`/${name}`)).sort();

/** The URL paths one `page.tsx` serves; `/[view]` expands to the overview plus every secondary view. */
export function pageRoutes(file: string): string[] {
  const route = `/${file.replace(/\/?page\.tsx$/, "")}`;
  return route === "/[view]" ? ["/overview", ...secondaryViews.map((view) => `/${view}`)] : [route];
}
