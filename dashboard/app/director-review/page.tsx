import type { Metadata } from "next";
import { DirectorReview } from "@/components/director/director-review";
import { requirePagePermission } from "@/lib/director/director-access";
import { publicPrincipal } from "@/lib/access/access-control";
import { validReportDate, wibDate } from "@/lib/director/director-data";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Review laporan | MelindaOS", robots: { index: false, follow: false } };
export default async function ReviewPage({ searchParams }: { searchParams: Promise<{ tanggal?: string | string[] }> }) {
  const { tanggal } = await searchParams;
  const date = typeof tanggal === "string" && validReportDate(tanggal) ? tanggal : wibDate();
  const { principal, allowedPages } = await requirePagePermission(`/director-review?tanggal=${date}`);
  return <DirectorReview key={date} date={date} principal={publicPrincipal(principal)} allowedPages={allowedPages} />;
}
