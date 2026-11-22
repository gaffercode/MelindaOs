"use client";

import { useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Activity, BedDouble, ChevronRight, CircleAlert, ClipboardCheck, DoorOpen, Gauge, ListChecks, Menu, RefreshCcw, Search } from "lucide-react";
import { Sidebar, MobileDrawer, Kpi, type DirectorSection } from "../shell";
import type { PublicPrincipal } from "@/lib/access/access-control";
import { pathForView, type View } from "@/lib/navigation";
import { DirectorSession } from "./director-session";
import { AnimatePresence } from "motion/react";
import { PageEnter } from "../motion";
import { QuickInstructionButton } from "../instruction/quick-instruction-button";
import { DirectorBell } from "./director-attention";

export function DirectorSummary({ metrics }: { metrics: { label: string; value: number | string | null; note: string; icon: "visits" | "claims" | "decisions" | "urgent" | "beds" | "occupancy" | "vacant" }[] }) {
  const icons = { visits: Activity, claims: ClipboardCheck, decisions: ListChecks, urgent: CircleAlert, beds: BedDouble, occupancy: Gauge, vacant: DoorOpen };
  return <section className="metric-grid director-summary" aria-label="Ringkasan eksekutif">{metrics.map(({ label, value, note, icon }, index) => <Kpi key={label} index={index} icon={icons[icon]} label={label} value={value === null ? "—" : typeof value === "string" ? value : new Intl.NumberFormat("id-ID").format(value)} number={typeof value === "number" ? value : null} helper={value === null ? "Data belum tersedia" : note} bars={[]} tone="neutral" />)}</section>;
}

/** `principal` is the client-safe subset (no id, no CSRF secret). `allowedPages` undefined renders everything, as before roles existed. */
export function DirectorShell({ children, date, pending, authenticated = false, followLatest = false, activeSection = "melinda", principal, allowedPages }: { children: ReactNode; date: string; pending: number | null; authenticated?: boolean; followLatest?: boolean; activeSection?: DirectorSection; principal?: PublicPrincipal | null; allowedPages?: string[] }) {
  const may = (path: string) => allowedPages === undefined || allowedPages.includes(path);
  const router = useRouter();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  function closeDrawer() { setDrawerOpen(false); window.setTimeout(() => menuButtonRef.current?.focus(), 0); }
  function navigate(view: View) { setDrawerOpen(false); router.push(pathForView(view)); }
  const breadcrumbSection =
    activeSection === "melinda-agent" ? "Melinda"
    : activeSection === "arahan" ? "Arahan Direktur"
    : activeSection === "rujukan-masuk" ? "Rujukan masuk"
    : activeSection === "klinis" ? "Data klinis"
    : activeSection === "satu-sehat" ? "Satu Sehat"
    : activeSection === "berita" ? "Warta & Regulasi"
    : activeSection === "studio" ? "Studio Dokumen RS"
    : activeSection === "isian-dokumen" ? "Isian dokumen"
    : activeSection === "starkes" ? "STARKES Command"
    : activeSection === "kredensial" ? "Kredensial BPJS 2026"
    : activeSection === "casemix" ? "Casemix Simulator"
    : activeSection === "order-obat" ? "Order obat"
    : activeSection === "formularium" ? "Formularium DPJP"
    : activeSection === "hrd" ? "Organisasi & SDM"
    : activeSection === "crm" ? "CRM"
    : activeSection === "ruang-kerja" ? "Ruang kerja"
    : activeSection === "pengguna" ? "Pengguna"
    : activeSection === "ganti-password" ? "Ganti password"
    : "RSIA Melinda DHAI";
  return <div className="app-shell">
    <Sidebar activeView="command" directorActive activeSection={activeSection} onNavigate={navigate} className="desktop-sidebar" principal={principal} allowedPages={allowedPages} />
    <AnimatePresence>{drawerOpen && <MobileDrawer key="drawer" activeView="command" directorActive activeSection={activeSection} onNavigate={navigate} onClose={closeDrawer} principal={principal} allowedPages={allowedPages} />}</AnimatePresence>
    <main className="min-w-0">
      <header className="app-header">
        <button ref={menuButtonRef} type="button" className="header-icon mobile-menu-toggle" aria-label="Buka navigasi" onClick={() => setDrawerOpen(true)}><Menu className="size-4" /></button>
        <nav className="header-breadcrumb" aria-label="Breadcrumb">{may("/") ? <Link href="/">Dashboard</Link> : <span>Dashboard</span>}<ChevronRight className="size-3" /><span aria-current="page">{breadcrumbSection}</span></nav>
        {may("/knowledge") && <form action="/knowledge" method="get" className="header-search"><Search className="size-4 shrink-0 text-[var(--muted)]" aria-hidden="true" /><label htmlFor="director-search" className="sr-only">Cari knowledge canonical</label><input id="director-search" name="q" placeholder="Cari pengetahuan…" aria-label="Cari knowledge canonical" className="min-w-0 flex-1 bg-transparent text-sm outline-none" maxLength={120} /><kbd className="hidden sm:block">Enter</kbd></form>}
        {may("/arahan") && <DirectorBell pending={pending} authenticated={authenticated} href={activeSection === "melinda" ? "#keputusan-direksi" : "/arahan"} />}
        {may("/") && <form action="/" method="get">{!followLatest && <input type="hidden" name="tanggal" value={date} />}<button type="submit" className="header-icon" aria-label="Perbarui laporan harian"><RefreshCcw className="size-4" /></button></form>}
        {authenticated && <>{may("/arahan") && <QuickInstructionButton context={breadcrumbSection} />}{may("/director-review") && <Link className="director-knowledge" href={`/director-review?tanggal=${date}`}>Review laporan</Link>}<DirectorSession kind={principal?.kind} /></>}
      </header>
      <PageEnter>{children}</PageEnter>
    </main>
  </div>;
}
