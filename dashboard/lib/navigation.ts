import type { DirectorSection } from "@/components/shell";

// Decisions/Audit (browser-only localStorage drafts) are no longer routed: the Director instruction
// register (Supabase) is the system of record. Their components remain only behind the overview.
export const secondaryViews = ["knowledge", "integrations"] as const;
export type View = "command" | typeof secondaryViews[number];

export function pathForView(view: View): string {
  return view === "command" ? "/overview" : `/${view}`;
}

export function viewFromSlug(slug: string): View | null {
  if (slug === "overview") return "command";
  return secondaryViews.find((view) => view === slug) ?? null;
}

export function knowledgePath(query: string): string {
  const term = query.trim();
  return term ? `${pathForView("knowledge")}?${new URLSearchParams({ q: term })}` : pathForView("knowledge");
}

export type SkeletonFrame = { frame: "director"; section: DirectorSection } | { frame: "workspace"; view: View | null } | { frame: "plain" };

const DIRECTOR_SKELETON_PATHS: Record<string, DirectorSection> = {
  "/": "melinda",
  "/melinda": "melinda-agent",
  "/arahan": "arahan",
  "/rujukan-masuk": "rujukan-masuk",
  "/satu-sehat": "satu-sehat",
  "/berita": "berita",
  "/studio": "studio",
  "/starkes": "starkes",
  "/casemix": "casemix",
  "/order-obat": "order-obat",
  "/formularium": "formularium",
  "/hrd": "hrd",
  "/crm": "crm",
};

/** Which shell the route-loading fallback paints for a path, so it matches the page that is about to arrive. */
export function sectionForPath(pathname: string): SkeletonFrame {
  const path = pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  if (path.startsWith("/arahan/")) return { frame: "director", section: "arahan" };
  const section = DIRECTOR_SKELETON_PATHS[path];
  if (section) return { frame: "director", section };
  const view = /^\/[^/]+$/.test(path) ? viewFromSlug(path.slice(1)) : null;
  return view ? { frame: "workspace", view } : { frame: "plain" };
}
