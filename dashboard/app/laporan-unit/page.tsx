import type { Metadata } from "next";
import { UnitReportEntry } from "@/components/unit-report-form";

export const metadata: Metadata = { title: "Laporan unit · MelindaOS", referrer: "no-referrer", robots: { index: false, follow: false } };
export default function UnitReportPage() { return <main className="unit-report-page"><UnitReportEntry /></main>; }
