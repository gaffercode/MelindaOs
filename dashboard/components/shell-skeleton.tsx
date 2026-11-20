"use client";

import { usePathname, useRouter } from "next/navigation";
import { pathForView, sectionForPath, type SkeletonFrame, type View } from "@/lib/navigation";
import { LoadingState } from "./loading-state";
import { Sidebar } from "./shell";

function SkeletonContent() {
  return <div className="page-content director-page report-page">
    <p className="shell-skeleton-status"><LoadingState /></p>
    <div className="shell-skeleton-title" aria-hidden="true" />
    <div className="shell-skeleton-block" aria-hidden="true" />
    <div className="shell-skeleton-block" aria-hidden="true" />
    <div className="shell-skeleton-block" aria-hidden="true" />
  </div>;
}

/** Static frame shown while a route loads: same sidebar as the destination, no data; the blocks only pulse gently (globals.css). */
export function ShellSkeletonFrame({ frame }: { frame: SkeletonFrame }) {
  const router = useRouter();
  const navigate = (view: View) => router.push(pathForView(view));
  if (frame.frame === "plain") {
    return <main className="shell-skeleton-plain"><p className="shell-skeleton-status"><LoadingState /></p></main>;
  }
  // The role is unknown while the route loads, so the rail shows no entries rather than another role's navigation.
  const sidebar = frame.frame === "director"
    ? <Sidebar activeView="command" directorActive activeSection={frame.section} onNavigate={navigate} className="desktop-sidebar" allowedPages={[]} />
    : <Sidebar activeView={frame.view ?? "command"} onNavigate={navigate} className="desktop-sidebar" allowedPages={[]} />;
  return <div className="app-shell">
    {sidebar}
    <main className="min-w-0">
      <header className="app-header" />
      <SkeletonContent />
    </main>
  </div>;
}

export function ShellSkeleton() {
  return <ShellSkeletonFrame frame={sectionForPath(usePathname())} />;
}
