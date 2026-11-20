import { notFound } from "next/navigation";
import { DashboardApp } from "@/components/dashboard-app";
import { viewFromSlug } from "@/lib/navigation";
import { requirePagePermission } from "@/lib/director/director-access";
import { publicPrincipal } from "@/lib/access/access-control";

export default async function DashboardPage({ params, searchParams }: {
  params: Promise<{ view: string }>;
  searchParams: Promise<{ q?: string | string[] }>;
}) {
  const view = viewFromSlug((await params).view);
  if (!view) notFound();
  const { principal, allowedPages } = await requirePagePermission(`/${(await params).view}`);
  const { q } = await searchParams;
  const query = view === "knowledge" && typeof q === "string" ? q : "";
  return <DashboardApp key={`${view}:${query}`} activeView={view} initialQuery={query} principal={publicPrincipal(principal)} allowedPages={allowedPages} />;
}
