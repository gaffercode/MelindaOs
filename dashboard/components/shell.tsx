"use client";

import { Activity, Award, BookOpenCheck, Building2, Calculator, ClipboardCheck, Database, FileText, Gauge, Handshake, Inbox, ListChecks, MessageCircle, Network, Newspaper, Package, ShieldCheck, UserCog, Users, Briefcase, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { motion } from "motion/react";
import Image from "next/image";
import { pathForView, type View } from "@/lib/navigation";
import { ROLE_LABELS, type PublicPrincipal } from "@/lib/access/access-control";
import { EnterItem } from "./motion";
import { AnimatedCounter } from "@/components/ui/animated-counter";
import { HookSidebar, type HookSidebarItem } from "@/components/ui/hook-sidebar";
import { MelindaLogo } from "@/components/entrance/melinda-logo";

export const navItems: Array<{ id: View; label: string; icon: typeof Gauge }> = [
  { id: "command", label: "Ringkasan", icon: Gauge },
  { id: "knowledge", label: "Pengetahuan", icon: Database },
  { id: "integrations", label: "Integrasi", icon: Network },
];

export function classNames(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(" ");
}

export type DirectorSection = "melinda" | "melinda-agent" | "arahan" | "rujukan-masuk" | "satu-sehat" | "berita" | "studio" | "isian-dokumen" | "starkes" | "casemix" | "kredensial" | "order-obat" | "formularium" | "hrd" | "crm" | "ruang-kerja" | "pengguna" | "ganti-password";

const icon = (Icon: typeof Gauge) => <Icon className="size-4" aria-hidden="true" />;
const reportItems: Array<{ section: DirectorSection; item: HookSidebarItem }> = [
  { section: "melinda", item: { label: "RSIA Melinda DHAI", href: "/", icon: icon(Building2) } },
  { section: "melinda-agent", item: { label: "Melinda", href: "/melinda", icon: icon(MessageCircle) } },
  { section: "arahan", item: { label: "Arahan Direktur", href: "/arahan", icon: icon(ClipboardCheck) } },
  { section: "rujukan-masuk", item: { label: "Rujukan masuk", href: "/rujukan-masuk", icon: icon(Inbox) } },
  { section: "satu-sehat", item: { label: "Satu Sehat", href: "/satu-sehat", icon: icon(Activity) } },
  { section: "berita", item: { label: "Warta & Regulasi", href: "/berita", icon: icon(Newspaper) } },
  { section: "studio", item: { label: "Studio Dokumen", href: "/studio", icon: icon(FileText) } },
  { section: "isian-dokumen", item: { label: "Isian dokumen", href: "/isian-dokumen", icon: icon(ListChecks) } },
  { section: "starkes", item: { label: "STARKES Command", href: "/starkes", icon: icon(Award) } },
  { section: "kredensial", item: { label: "Kredensial BPJS", href: "/kredensial", icon: icon(ShieldCheck) } },
  { section: "casemix", item: { label: "Casemix Simulator", href: "/casemix", icon: icon(Calculator) } },
];
const pharmacyItems: Array<{ section: DirectorSection; item: HookSidebarItem }> = [
  { section: "order-obat", item: { label: "Order obat", href: "/order-obat", icon: icon(Package) } },
  { section: "formularium", item: { label: "Formularium DPJP", href: "/formularium", icon: icon(BookOpenCheck) } },
];
const peopleItems: Array<{ section: DirectorSection; item: HookSidebarItem }> = [
  { section: "hrd", item: { label: "Organisasi & SDM", href: "/hrd", icon: icon(Users) } },
  { section: "crm", item: { label: "CRM", href: "/crm", icon: icon(Handshake) } },
];
const helpItems: Array<{ section: DirectorSection; item: HookSidebarItem }> = [
  { section: "ruang-kerja", item: { label: "Ruang kerja", href: "/ruang-kerja", icon: icon(Briefcase) } },
  { section: "pengguna", item: { label: "Pengguna", href: "/pengguna", icon: icon(UserCog) } },
];
/** Sidebar label of every page that has one, by page path. */
export const PAGE_LABELS: Readonly<Record<string, string>> = Object.fromEntries([
  ...[...reportItems, ...pharmacyItems, ...peopleItems, ...helpItems].flatMap((row) => typeof row.item === "string" || !row.item.href ? [] : [[row.item.href, row.item.label]]),
  ...navItems.map((entry) => [pathForView(entry.id), entry.label]),
]);
// Entries that exist only for the role system show when `allowedPages` names them; every other entry shows when `allowedPages` is undefined.
const ROLE_ONLY_PAGES = ["/ruang-kerja", "/pengguna"];

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0].toUpperCase()).join("");
}

export function Sidebar({ activeView, onNavigate, className, directorActive = false, activeSection = "melinda", identity = true, principal, allowedPages }: {
  activeView: View; onNavigate: (view: View) => void; className?: string; directorActive?: boolean; activeSection?: DirectorSection; identity?: boolean;
  principal?: PublicPrincipal | null; allowedPages?: string[];
}) {
  const visible = (href: string | undefined) => href === undefined || (allowedPages ? allowedPages.includes(href) : !ROLE_ONLY_PAGES.includes(href));
  const rowsOf = (rows: Array<{ section: DirectorSection; item: HookSidebarItem }>) => rows.filter((row) => visible(typeof row.item === "string" ? undefined : row.item.href));
  const system = navItems.filter((entry) => !allowedPages || allowedPages.includes(pathForView(entry.id)));
  const account = principal?.kind === "account" ? principal : null;
  // One rail per group; only the group that holds the current page shows its accent line (value -1 draws none).
  const at = (rows: Array<{ section: DirectorSection }>) => directorActive ? rows.findIndex((row) => row.section === activeSection) : -1;
  const group = (title: string, label: string, all: Array<{ section: DirectorSection; item: HookSidebarItem }>) => {
    const rows = rowsOf(all);
    return rows.length > 0 && <section className="sidebar-group">
      <h2>{title}</h2>
      <HookSidebar aria-label={label} items={rows.map((row) => row.item)} value={at(rows)} />
    </section>;
  };
  return <aside className={classNames("workspace-sidebar", className)}>
    {identity && <div className="workspace-card">
      <span className="workspace-card-row"><Image className="workspace-logo" src="/brand/melindaos-logo.png" alt="MelindaOS" width={92} height={94} priority unoptimized /><span className="workspace-name"><strong>MelindaOS</strong><small>RSIA Melinda DHAI</small></span></span>
    </div>}
    <nav aria-label="Navigasi utama" className="sidebar-navigation">
      {group("Laporan eksekutif", "Laporan eksekutif", reportItems)}
      {group("Farmasi", "Farmasi", pharmacyItems)}
      {group("SDM & Mitra", "SDM dan Mitra", peopleItems)}
      {group("Bantuan", "Bantuan", helpItems)}
      {system.length > 0 && <section className="sidebar-group">
        <h2>Sistem</h2>
        <HookSidebar aria-label="Sistem" items={system.map((entry) => ({ label: entry.label, icon: icon(entry.icon) }))} value={directorActive ? -1 : system.findIndex((entry) => entry.id === activeView)} onChange={(index) => onNavigate(system[index].id)} />
      </section>}
    </nav>
    <div className="sidebar-footer">
      {account
        ? <div className="sidebar-profile"><span className="profile-avatar" aria-hidden="true">{initials(account.displayName)}</span><span><strong>{account.displayName}</strong><small>{ROLE_LABELS[account.role]}</small></span></div>
        : <div className="sidebar-profile"><span className="profile-avatar">FA</span><span><strong>dr. Ferdi Andriska, S.H., M.Kn., CMDC</strong><small>Direktur</small></span></div>}
    </div>
  </aside>;
}

export function MobileDrawer({ activeView, onNavigate, onClose, directorActive = false, activeSection = "melinda", principal, allowedPages }: {
  activeView: View; onNavigate: (view: View) => void; onClose: () => void; directorActive?: boolean; activeSection?: DirectorSection;
  principal?: PublicPrincipal | null; allowedPages?: string[];
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  useEffect(() => { closeRef.current?.focus(); const handler = (event: KeyboardEvent) => { if (event.key === "Escape") onCloseRef.current(); }; window.addEventListener("keydown", handler); return () => window.removeEventListener("keydown", handler); }, []);
  return <div className="drawer-motion fixed inset-0 z-50 xl:hidden" role="dialog" aria-modal="true" aria-label="Navigasi utama">
    <motion.button type="button" className="drawer-scrim absolute inset-0 bg-black/50 backdrop-blur-[2px]" aria-label="Tutup navigasi" onClick={onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
    <motion.div className="drawer-panel" initial={{ x: -16, opacity: 0.8 }} animate={{ x: 0, opacity: 1 }} exit={{ x: -16, opacity: 0 }}>
      <div className="drawer-header"><span className="drawer-logo" aria-hidden="true"><MelindaLogo /></span><span className="drawer-identity"><strong>MelindaOS</strong><small>RSIA Melinda DHAI</small></span><button ref={closeRef} type="button" onClick={onClose} className="header-icon" aria-label="Tutup navigasi"><X className="size-4" /></button></div>
      <Sidebar activeView={activeView} onNavigate={onNavigate} className="drawer-sidebar" directorActive={directorActive} activeSection={activeSection} identity={false} principal={principal} allowedPages={allowedPages} />
    </motion.div>
  </div>;
}

/**
 * `number` (with an optional `unit` suffix) renders the figure through Rare UI's AnimatedCounter: the digits roll only when the
 * value changes after mount (`initial={false}` inside), never count up from zero, and read as plain text for screen readers
 * and under reduced motion. `value` stays the text shown while loading or when there is no figure ("…", "—").
 */
export function Kpi({ icon: Icon, tone, label, value, number, unit, helper, bars, index = 0 }: { icon: typeof Activity; tone: "good" | "attention" | "info" | "neutral"; label: string; value: string; number?: number | null; unit?: string; helper: string; bars: number[]; index?: number }) {
  const maxBar = Math.max(1, ...bars);
  const figure = typeof number === "number" && Number.isFinite(number) ? <AnimatedCounter value={number} separator="." decimalSeparator="," duration={0.5} suffix={unit} /> : value;
  return <EnterItem as="article" className="metric-card" index={index}>
    <div className="metric-surface"><div className="metric-label"><h2>{label}</h2><Icon className="size-3.5" /></div><div className="metric-value"><strong>{figure}</strong><div className="metric-sparkbars" aria-hidden="true">{bars.map((bar, index) => <span key={index} className={index === bars.length - 1 ? "is-accent" : undefined} style={{ height: bar / maxBar * 100 + "%" }} />)}</div></div></div>
    <div className="metric-footer"><span className={classNames("metric-status", tone === "good" && "is-good")} /><small title={helper}>{helper}</small></div>
  </EnterItem>;
}
