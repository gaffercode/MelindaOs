"use client";

import {
  Activity,
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  FileSearch,
  Inbox,
  Menu,
  Pencil,
  Plus,
  RadioTower,
  RefreshCcw,
  RotateCcw,
  Search,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import { FormEvent, Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AskMelinda } from "@/components/ask-melinda";
import { LoadingState } from "@/components/loading-state";
import { BufferQueuePanel } from "@/components/buffer-queue-panel";
import { FillLists } from "@/components/fill-lists";
import { createBriefingPreview } from "@/lib/briefing";
import { fetchDashboard, fetchSearch } from "@/lib/client-api";
import { saveDecisionForm } from "@/lib/decision/decision-form";
import { useDecisionSession } from "@/components/decision/decision-provider";
import { classNames, Kpi, MobileDrawer, navItems, Sidebar } from "@/components/shell";
import type { PublicPrincipal } from "@/lib/access/access-control";
import { SourceInfo } from "@/components/source-info";
import { AnimatePresence } from "motion/react";
import { MOTION, PageEnter, reducedMotion, useClosing } from "@/components/motion";
import { knowledgePath, pathForView, type View } from "@/lib/navigation";
import type { DashboardData, SearchResult } from "@/lib/contracts";
import { type Decision, type DecisionPriority } from "@/lib/decision/decision-state";

type DialogState = { kind: "decision"; decision?: Decision } | { kind: "resolve"; decision: Decision } | { kind: "briefing" } | null;

const emptyData: DashboardData = {
  validation: {
    status: "unavailable",
    scannedAt: new Date(0).toISOString(),
    counts: [],
    passed: 0,
    total: 0,
    limitation: "Menunggu checker.",
  },
  providers: [],
  documentCount: 0,
};
// The page re-mounts DashboardApp on every view change; the last snapshot shows at once while it refreshes.
let lastSnapshot: DashboardData | null = null;

function formatDate(value: string): string {
  if (!value || !Number.isFinite(Date.parse(value))) return "—";
  return new Intl.DateTimeFormat("id-ID", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(value));
}

function uid(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

function priorityLabel(priority: DecisionPriority): string {
  return { critical: "Critical", high: "High", medium: "Medium", low: "Low" }[priority];
}

export function DashboardApp({ activeView = "command", initialQuery = "", principal, allowedPages }: { activeView?: View; initialQuery?: string; principal?: PublicPrincipal | null; allowedPages?: string[] }) {
  const router = useRouter();
  const [data, setData] = useState<DashboardData>(lastSnapshot ?? emptyData);
  const [loading, setLoading] = useState(lastSnapshot === null);
  const [loadError, setLoadError] = useState("");
  const { state: decisionState, ready: storageReady, error: storageError, dispatch } = useDecisionSession();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [dialog, setDialog] = useState<DialogState>(null);
  // Every way out of a dialog (close, cancel, Escape, save) plays the same short exit before it unmounts.
  const [dialogClosing, closeDialog, keepDialog] = useClosing(() => setDialog(null));
  // Opening a dialog while another is still fading out replaces it instead of being closed by that fade.
  function openDialog(next: Exclude<DialogState, null>) { keepDialog(); setDialog(next); }
  const [query, setQuery] = useState(initialQuery);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const dashboardRequest = useRef<AbortController | null>(null);
  const searchRequest = useRef<AbortController | null>(null);

  const loadDashboard = useCallback(async (controller: AbortController) => {
    try {
      const snapshot = await fetchDashboard(controller.signal);
      if (!controller.signal.aborted) {
        lastSnapshot = snapshot;
        setData(snapshot);
      }
    } catch (error: unknown) {
      if (!controller.signal.aborted) setLoadError(error instanceof Error ? error.message : "Dashboard data tidak tersedia.");
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, []);

  async function refreshDashboard() {
    dashboardRequest.current?.abort();
    const controller = new AbortController();
    dashboardRequest.current = controller;
    setLoading(true);
    setLoadError("");
    await loadDashboard(controller);
  }

  useEffect(() => {
    const controller = new AbortController();
    dashboardRequest.current = controller;
    void Promise.resolve().then(() => loadDashboard(controller));
    return () => {
      dashboardRequest.current?.abort();
    };
  }, [loadDashboard]);

  const activeDecisions = decisionState.decisions.filter((decision) => decision.status === "local_draft");

  function navigate(view: View) {
    router.push(pathForView(view));
    setDrawerOpen(false);
    window.setTimeout(() => menuButtonRef.current?.focus(), 0);
  }

  const runSearch = useCallback(async (term: string) => {
    searchRequest.current?.abort();
    const controller = new AbortController();
    searchRequest.current = controller;
    setSearchError("");
    if (!term) {
      setSearchResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    setSearchResults([]);
    try {
      const results = await fetchSearch(term, controller.signal);
      if (!controller.signal.aborted) setSearchResults(results);
    } catch (error: unknown) {
      if (!controller.signal.aborted) setSearchError(error instanceof Error ? error.message : "Search gagal.");
    } finally {
      if (!controller.signal.aborted) setSearching(false);
    }
  }, []);

  useEffect(() => {
    const task = window.setTimeout(() => {
      if (activeView === "knowledge") void runSearch(initialQuery.trim());
    }, 0);
    return () => {
      window.clearTimeout(task);
      searchRequest.current?.abort();
    };
  }, [activeView, initialQuery, runSearch]);

  async function search(event?: FormEvent) {
    event?.preventDefault();
    const term = query.trim();
    if (activeView === "knowledge" && term === initialQuery.trim()) await runSearch(term);
    else router.push(knowledgePath(term));
  }

  const viewTitle = navItems.find((item) => item.id === activeView)?.label ?? "Command";

  return (
    <div className="app-shell">
      <Sidebar activeView={activeView} onNavigate={navigate} className="desktop-sidebar" principal={principal} allowedPages={allowedPages} />
      <AnimatePresence>
        {drawerOpen && (
          <MobileDrawer
            key="drawer"
            activeView={activeView}
            onNavigate={navigate}
            principal={principal}
            allowedPages={allowedPages}
            onClose={() => {
              setDrawerOpen(false);
              window.setTimeout(() => menuButtonRef.current?.focus(), 0);
            }}
          />
        )}
      </AnimatePresence>

      <main className="min-w-0">
        <header className="app-header">
          <button
            ref={menuButtonRef}
            type="button"
            className="header-icon mobile-menu-toggle"
            aria-label="Buka navigasi"
            onClick={() => setDrawerOpen(true)}
          >
            <Menu className="size-4" />
          </button>
          <nav className="header-breadcrumb" aria-label="Breadcrumb">
            <button type="button" onClick={() => navigate("command")}>
              Dashboard
            </button>
            <ChevronRight className="size-3" />
            <span aria-current="page">{viewTitle}</span>
          </nav>
          <form onSubmit={search} className="header-search">
            <Search className="size-4 shrink-0 text-[var(--muted)]" aria-hidden="true" />
            <label htmlFor="global-search" className="sr-only">
              Cari knowledge canonical
            </label>
            <input
              id="global-search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search knowledge…"
              className="min-w-0 flex-1 bg-transparent text-sm outline-none"
              maxLength={120}
            />
            <kbd className="hidden sm:block">Enter</kbd>
          </form>
          <button
            type="button"
            className="header-icon"
            aria-label="Refresh repository snapshot"
            onClick={refreshDashboard}
            disabled={loading}
          >
            <RefreshCcw className={classNames("size-4", loading && "animate-spin")} />
          </button>
        </header>

        <PageEnter className="page-content">
          {storageError && (
            <div
              role="status"
              className="flex items-start gap-3 rounded-xl border border-warn-line bg-[var(--warn-soft)] px-4 py-3 text-sm text-[var(--warn)]"
            >
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <span>{storageError}</span>
            </div>
          )}
          {activeView !== "command" && loadError && (
            <div role="alert" className="rounded-xl border border-[var(--danger)] bg-[var(--danger-soft)] p-4 text-sm">
              <p>{loadError}</p>
              <button type="button" onClick={refreshDashboard} disabled={loading} className="button-secondary mt-3">
                Retry snapshot
              </button>
            </div>
          )}
          {activeView !== "command" && loading && (
            <p className="m-0">
              <LoadingState label="Memuat snapshot repository" />
            </p>
          )}
          <div className="page-heading">
            <div>
              <h1>{activeView === "command" ? "Welcome back, Dr. Ferdi" : viewTitle}</h1>
              {activeView !== "command" && <p className="mt-1 text-sm text-[var(--muted)]">{viewSubtitle(activeView)}</p>}
            </div>
            <div className="page-actions">
              {activeView === "command" && (
                <span className="snapshot-date">
                  <CalendarDays className="size-3.5" />
                  {data.validation.status === "available" ? formatDate(data.validation.scannedAt) : "Repository snapshot"}
                </span>
              )}
              {activeView === "command" && (
                <button type="button" className="button-secondary" onClick={() => openDialog({ kind: "briefing" })}>
                  <Sparkles className="size-4" />
                  Briefing
                </button>
              )}
              {activeView === "command" && (
                <button type="button" className="button-primary" disabled={!storageReady} onClick={() => openDialog({ kind: "decision" })}>
                  <Plus className="size-4" />
                  New decision
                </button>
              )}
            </div>
          </div>

          {activeView === "command" && (
            <CommandView
              data={data}
              loading={loading}
              error={loadError}
              decisions={activeDecisions}
              onRefresh={refreshDashboard}
              onEdit={(decision) => openDialog({ kind: "decision", decision })}
              onResolve={(decision) => openDialog({ kind: "resolve", decision })}
            />
          )}
          {activeView === "knowledge" && (
            <KnowledgeView
              query={query}
              setQuery={setQuery}
              onSearch={search}
              results={searchResults}
              searching={searching}
              error={searchError}
              data={data}
            />
          )}
          {activeView === "integrations" && <IntegrationsView />}
        </PageEnter>
      </main>

      {/* Inert while it fades out, so a second click or Enter cannot submit the dialog again. */}
      <div className="dialog-layer" data-closing={dialogClosing || undefined} inert={dialogClosing}>
      {dialog?.kind === "decision" && (
        <DecisionDialog
          decision={dialog.decision}
          onClose={closeDialog}
          onSave={(decision) => {
            dispatch({ type: dialog.decision ? "edit" : "create", decision, eventId: uid("event"), correlationId: uid("correlation") });
            closeDialog();
          }}
        />
      )}
      {dialog?.kind === "resolve" && (
        <ResolveDialog
          decision={dialog.decision}
          onClose={closeDialog}
          onResolve={(reason) => {
            dispatch({
              type: "resolve",
              id: dialog.decision.id,
              reason,
              at: new Date().toISOString(),
              eventId: uid("event"),
              correlationId: uid("correlation"),
            });
            closeDialog();
          }}
        />
      )}
      {dialog?.kind === "briefing" && <BriefingDialog data={data} decisions={decisionState.decisions} onClose={closeDialog} />}
      </div>
    </div>
  );
}

function viewSubtitle(view: View): string {
  return {
    command: "",
    knowledge: "Cari hanya dokumen canonical aktif; raw dan archive tidak diindeks.",
    decisions: "Draft keputusan lokal; bukan approval atau bukti eksekusi rumah sakit.",
    integrations: "Antrian Buffer live dan capability yang dideklarasikan di repository.",
    audit: "Jejak mutasi prototipe lokal dan dapat dihapus dari perangkat ini.",
  }[view];
}

function CommandView({
  data,
  loading,
  error,
  decisions,
  onRefresh,
  onEdit,
  onResolve,
}: {
  data: DashboardData;
  loading: boolean;
  error: string;
  decisions: Decision[];
  onRefresh: () => void;
  onEdit: (decision: Decision) => void;
  onResolve: (decision: Decision) => void;
}) {
  const [chartMode, setChartMode] = useState<"volume" | "coverage">("volume");
  const validPercent = data.validation.total ? Math.round((data.validation.passed / data.validation.total) * 1000) / 10 : 0;
  const chartScale =
    chartMode === "coverage" ? 100 : Math.max(1, Math.ceil(Math.max(0, ...data.validation.counts.map((row) => row.total)) / 50) * 50);
  return (
    <>
      <section className="metric-grid" aria-label="Institution snapshot">
        <Kpi
          icon={ShieldCheck}
          tone="good"
          label="Governance"
          value={loading ? "…" : data.validation.status === "available" ? String(validPercent) + "%" : "—"}
          number={!loading && data.validation.status === "available" ? validPercent : null}
          unit="%"
          helper={
            data.validation.status === "available"
              ? data.validation.passed + "/" + data.validation.total + " documents validated"
              : "Checker unavailable"
          }
          bars={data.validation.counts.map((row) => row.total)}
        />
        <Kpi
          icon={Inbox}
          tone="attention"
          label="Local decisions"
          value={String(decisions.length)}
          number={decisions.length}
          helper="Drafts stored on this device"
          bars={["critical", "high", "medium", "low"].map(
            (priority) => decisions.filter((decision) => decision.priority === priority).length,
          )}
        />
        <Kpi
          icon={RadioTower}
          tone="neutral"
          label="Providers"
          value={loading ? "…" : String(data.providers.length)}
          number={loading ? null : data.providers.length}
          helper="Declared · runtime unobserved"
          bars={data.providers.map((provider) => provider.capabilities.length)}
        />
      </section>
      {error && (
        <div
          role="alert"
          className="flex items-center justify-between rounded-xl border border-[var(--danger)] bg-[var(--danger-soft)] p-4 text-sm"
        >
          <span>{error}</span>
          <button type="button" onClick={onRefresh} className="button-secondary">
            <RefreshCcw className="size-4" />
            Retry
          </button>
        </div>
      )}
      <section className="chart-grid">
        <article className="chart-panel">
          <div className="chart-panel-heading">
            <h2>Canonical Knowledge</h2>
            <ShieldCheck className="size-4" aria-label="Fresh format and governance validation" />
          </div>
          <div className="chart-panel-surface">
            <div className="chart-summary">
              <div className="chart-total">
                <span>Validated documents</span>
                <strong>{loading ? "…" : data.validation.status === "available" ? data.validation.passed : "—"}</strong>
              </div>
              <div className="chart-controls" aria-label="Validation chart display">
                <button type="button" aria-pressed={chartMode === "volume"} onClick={() => setChartMode("volume")}>
                  Volume
                </button>
                <button type="button" aria-pressed={chartMode === "coverage"} onClick={() => setChartMode("coverage")}>
                  Coverage
                </button>
              </div>
            </div>
            <div className="chart-legend">
              <span>
                <i className="legend-passed" />
                Passed
              </span>
              <span>
                <i className="legend-total" />
                Total documents
              </span>
            </div>
            <div
              className="validation-plot"
              role="img"
              aria-label={
                data.validation.status === "available"
                  ? data.validation.counts
                      .map((row) => "Category " + row.category + ": " + row.passed + " of " + row.total + " passed")
                      .join(". ")
                  : "Validation data unavailable"
              }
            >
              <div className="plot-axis" aria-hidden="true">
                {[0, 1, 2, 3, 4].map((index) => (
                  <span key={index} style={{ top: index * 25 + "%" }}>
                    {chartMode === "coverage" ? 100 - index * 25 + "%" : Math.round(chartScale * (1 - index / 4))}
                  </span>
                ))}
              </div>
              <div className="plot-grid" aria-hidden="true">
                {[0, 1, 2, 3, 4].map((index) => (
                  <span key={index} style={{ top: index * 25 + "%" }} />
                ))}
              </div>
              <div className="plot-bars">
                {(["A", "B", "C"] as const).map((category) => {
                  const row = data.validation.counts.find((item) => item.category === category);
                  const totalHeight = row ? (chartMode === "volume" ? (row.total / chartScale) * 100 : 100) : 0;
                  const passedHeight = row?.total
                    ? chartMode === "volume"
                      ? (row.passed / chartScale) * 100
                      : (row.passed / row.total) * 100
                    : 0;
                  return (
                    <div className="plot-column" key={category}>
                      <div className="plot-bar-track">
                        <PlotBar className="plot-bar-total" percent={totalHeight} />
                        <PlotBar className="plot-bar-passed" percent={passedHeight} />
                        <strong className="plot-value" style={{ bottom: Math.min(92, totalHeight) + "%" }}>
                          {row
                            ? chartMode === "coverage"
                              ? Math.round((row.passed / Math.max(1, row.total)) * 100) + "%"
                              : row.passed
                            : "—"}
                        </strong>
                      </div>
                      <div className="plot-label">
                        <strong>Category {category}</strong>
                        <span>{{ A: "Knowledge", B: "Agent rules", C: "Schemas" }[category]}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="chart-footnote">
              <span className="status-dot" />
              {data.validation.status === "available"
                ? "Fresh checker · " + data.validation.passed + "/" + data.validation.total + " passed"
                : "Waiting for repository scan"}
              <span>Format & governance</span>
            </div>
          </div>
        </article>
      </section>
      <DecisionTable decisions={decisions.slice(0, 5)} onEdit={onEdit} onResolve={onResolve} />
    </>
  );
}

function PanelHead({ eyebrow, title, icon: Icon }: { eyebrow: string; title: string; icon: typeof Activity }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="grid gap-0.5">
        <span className="text-xs font-medium text-[var(--muted)]">{eyebrow}</span>
        <strong className="text-sm">{title}</strong>
      </span>
      <Icon className="size-4 text-[var(--muted)]" />
    </div>
  );
}

export function DecisionTable({
  decisions,
  onEdit,
  onResolve,
  onReopen,
}: {
  decisions: Decision[];
  onEdit: (decision: Decision) => void;
  onResolve?: (decision: Decision) => void;
  onReopen?: (decision: Decision) => void;
}) {
  return (
    <article className="decision-table">
      <div className="flex items-center justify-between p-4">
        <span>
          <span className="block text-xs font-medium text-[var(--muted)]">Local prototype</span>
          <strong className="text-sm">Decision Inbox</strong>
        </span>
        <span className="rounded-md bg-[var(--accent-soft)] px-2 py-1 text-xs font-semibold text-[var(--accent)]">
          Not institutional record
        </span>
      </div>
      <div className="scrollbar-thin overflow-x-auto">
        <table className="w-full min-w-[760px] border-collapse text-left text-sm">
          <thead className="bg-[var(--surface-soft)] text-xs text-[var(--muted)]">
            <tr>
              <th className="px-3 py-2 font-medium">Priority</th>
              <th className="px-3 py-2 font-medium">Issue / recommendation</th>
              <th className="px-3 py-2 font-medium">Owner</th>
              <th className="px-3 py-2 font-medium">Due</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {decisions.length ? (
              decisions.map((decision) => (
                <tr key={decision.id} className="border-t border-[var(--line)]">
                  <td className="px-3 py-3">
                    <PriorityBadge priority={decision.priority} />
                  </td>
                  <td className="max-w-md px-3 py-3">
                    <strong className="block">{decision.title}</strong>
                    <small className="mt-1 block text-xs text-[var(--muted)]">{decision.recommendation}</small>
                  </td>
                  <td className="px-3 py-3">{decision.owner}</td>
                  <td className="px-3 py-3 whitespace-nowrap">{formatDate(decision.dueDate)}</td>
                  <td className="px-3 py-3">
                    <span className="rounded-md bg-[var(--surface-soft)] px-2 py-1 text-xs font-semibold text-[var(--muted)]">
                      {decision.status === "local_draft" ? "Local draft" : "Locally resolved"}
                    </span>
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex justify-end gap-1">
                      <button
                        type="button"
                        onClick={() => onEdit(decision)}
                        className="grid size-8 place-items-center rounded-lg hover:bg-[var(--surface-soft)]"
                        aria-label={`Edit ${decision.title}`}
                      >
                        <Pencil className="size-4" />
                      </button>
                      {decision.status === "local_draft" && onResolve && (
                        <button
                          type="button"
                          onClick={() => onResolve(decision)}
                          className="grid size-8 place-items-center rounded-lg text-[var(--good)] hover:bg-[var(--good-soft)]"
                          aria-label={`Resolve ${decision.title}`}
                        >
                          <CheckCircle2 className="size-4" />
                        </button>
                      )}
                      {decision.status === "locally_resolved" && onReopen && (
                        <button
                          type="button"
                          onClick={() => onReopen(decision)}
                          className="grid size-8 place-items-center rounded-lg text-[var(--accent)] hover:bg-[var(--accent-soft)]"
                          aria-label={`Reopen ${decision.title}`}
                        >
                          <RotateCcw className="size-4" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={6} className="px-3 py-12 text-center text-sm text-[var(--muted)]">
                  Tidak ada decision untuk filter ini.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </article>
  );
}

function PriorityBadge({ priority }: { priority: DecisionPriority }) {
  const classes = {
    critical: "bg-[var(--danger-soft)] text-[var(--danger)]",
    high: "bg-[var(--orange-soft)] text-[var(--orange-ink)]",
    medium: "bg-[var(--warn-soft)] text-[var(--warn)]",
    low: "bg-[var(--surface-soft)] text-[var(--muted)]",
  }[priority];
  return <span className={classNames("inline-flex rounded-md px-2 py-1 text-xs font-semibold", classes)}>{priorityLabel(priority)}</span>;
}

export function KnowledgeView({
  query,
  setQuery,
  onSearch,
  results,
  searching,
  error,
  data,
}: {
  query: string;
  setQuery: (value: string) => void;
  onSearch: (event?: FormEvent) => Promise<void>;
  results: SearchResult[];
  searching: boolean;
  error: string;
  data: DashboardData;
}) {
  return (
    <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_280px]">
      <div className="grid min-w-0 content-start gap-3">
        <AskMelinda />
        <section aria-labelledby="knowledge-search-title" className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4">
          <h2 id="knowledge-search-title" className="m-0 mb-3 text-[length:var(--type-title-sm)] font-medium">
            Cari dokumen
          </h2>
          <form onSubmit={onSearch} className="flex gap-2">
            <label htmlFor="knowledge-search" className="sr-only">
              Cari corpus canonical
            </label>
            <div className="flex h-11 min-w-0 flex-1 items-center gap-2 rounded-lg border border-[var(--line)] px-3">
              <Search className="size-4 text-[var(--muted)]" />
              <input
                id="knowledge-search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="min-w-0 flex-1 outline-none"
                placeholder="Contoh: BPJS klaim, izin rumah sakit…"
                maxLength={120}
              />
            </div>
            <button type="submit" className="h-11 rounded-lg bg-[var(--accent)] px-4 text-sm font-semibold text-white">
              Search
            </button>
          </form>
          {error && (
            <p role="alert" className="mt-3 rounded-lg bg-[var(--danger-soft)] p-3 text-sm text-[var(--danger)]">
              {error}
            </p>
          )}
          <div className="mt-4 grid gap-2">
            {searching ? (
              <div className="grid place-items-center py-12">
                <LoadingState label="Mencari canonical corpus" />
              </div>
            ) : results.length ? (
              <>
              {results.every((result) => result.match === "partial") && (
                <p role="status" className="m-0 text-sm text-[var(--muted)]">Tidak ada dokumen yang memuat semua kata. Menampilkan hasil terdekat.</p>
              )}
              {results.map((result, position) => (
                <Fragment key={result.path}>
                {result.match === "partial" && position > 0 && results[position - 1].match === "full" && (
                  <p role="status" className="m-0 mt-2 text-sm text-[var(--muted)]">Hasil terdekat: dokumen di bawah ini tidak memuat semua kata persis seperti diketik.</p>
                )}
                <article className="rounded-xl border border-[var(--line)] p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded bg-[var(--surface-soft)] px-2 py-1 text-xs font-semibold">Category {result.category}</span>
                    {result.domain && <span className="text-xs text-[var(--muted)]">{result.domain}</span>}
                    {result.lastReviewed && <span className="ml-auto text-xs text-[var(--muted)]">Reviewed {result.lastReviewed}</span>}
                    {result.aiFills?.length ? (
                      <SourceInfo>
                        <FillLists fills={result.aiFills} />
                      </SourceInfo>
                    ) : null}
                  </div>
                  <h2 className="mt-2 text-base font-semibold">{result.title}</h2>
                  <p className="mt-1 text-sm leading-relaxed text-[var(--muted)]">{result.snippet}</p>
                  <div className="mt-3 flex flex-wrap gap-2 text-xs">
                    <code className="rounded bg-[var(--surface-soft)] px-2 py-1">{result.docId || "No doc_id"}</code>
                    <code className="rounded bg-[var(--surface-soft)] px-2 py-1">{result.path}</code>
                  </div>
                </article>
                </Fragment>
              ))}
              </>
            ) : (
              <div className="grid place-items-center py-16 text-center">
                <FileSearch className="size-9 text-[var(--brand-teal)]" />
                <strong className="mt-3 text-base">Cari knowledge canonical</strong>
                <p className="mt-1 max-w-sm text-sm text-[var(--muted)]">Hasil default tidak pernah mengambil sources/raw atau knowledge/99_ARCHIVE.</p>
              </div>
            )}
          </div>
        </section>
      </div>
      <aside className="grid content-start gap-3">
        <article className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4">
          <PanelHead eyebrow="Search boundary" title="Canonical only" icon={ShieldCheck} />
          <dl className="mt-4 grid gap-3 text-sm">
            <div className="flex justify-between">
              <dt className="text-[var(--muted)]">Indexed</dt>
              <dd className="font-semibold">{data.documentCount || "—"}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-[var(--muted)]">Raw</dt>
              <dd className="font-semibold">Excluded</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-[var(--muted)]">Archive</dt>
              <dd className="font-semibold">Excluded</dd>
            </div>
          </dl>
        </article>
        <article className="rounded-xl border border-[var(--info-line)] bg-[var(--info-soft)] p-4 text-sm leading-relaxed text-[var(--info)]">
          <strong className="block">Trust note</strong>
          <p className="mt-1">
            Search menemukan dokumen; ia tidak membuktikan isi masih berlaku untuk data dinamis. Gunakan sistem live authoritative untuk
            jadwal, antrean, bed, dan transaksi.
          </p>
        </article>
      </aside>
    </div>
  );
}

function IntegrationsView() {
  return <BufferQueuePanel />;
}

/**
 * A validation-plot bar. Its height is set at once; the change is then played back as a transform (FLIP), so switching
 * Volume/Coverage or refreshing morphs the same bar without animating layout. A change that arrives mid-way starts from the
 * size on screen. Nothing plays under reduced motion.
 */
function PlotBar({ className, percent }: { className: string; percent: number }) {
  const element = useRef<HTMLSpanElement>(null);
  const previous = useRef(percent);
  useLayoutEffect(() => {
    const before = previous.current;
    previous.current = percent;
    const bar = element.current;
    if (!bar || before === percent || percent <= 0 || typeof bar.animate !== "function" || reducedMotion()) return;
    // The scale a running animation still applies, so an interrupted change continues from what is visible.
    const running = bar.offsetHeight > 0 ? bar.getBoundingClientRect().height / bar.offsetHeight : 1;
    bar.getAnimations().forEach((animation) => animation.cancel());
    bar.animate([{ transform: `scaleY(${(running * before) / percent})` }, { transform: "scaleY(1)" }], { duration: MOTION.layout * 1000, easing: "cubic-bezier(0.2, 0, 0, 1)" });
  }, [percent]);
  return <span ref={element} className={className} style={{ height: percent + "%" }} />;
}

function DialogFrame({
  title,
  description,
  onClose,
  children,
}: {
  title: string;
  description: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);
  return (
    <div
      className="fixed inset-0 z-[60] grid place-items-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="dialog-title"
      aria-describedby="dialog-description"
    >
      <button
        type="button"
        className="dialog-scrim absolute inset-0 bg-[var(--dialog-scrim)] backdrop-blur-[2px]"
        aria-label="Tutup dialog"
        onClick={onClose}
      />
      <section className="dialog-panel relative max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-[var(--line)] bg-[var(--surface)] shadow-2xl">
        <header className="sticky top-0 z-10 flex items-start justify-between border-b border-[var(--line)] bg-[var(--surface)] p-5">
          <div>
            <h2 id="dialog-title" className="text-xl font-semibold">
              {title}
            </h2>
            <p id="dialog-description" className="mt-1 text-sm text-[var(--muted)]">
              {description}
            </p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="grid size-11 place-items-center rounded-lg border border-[var(--line)]"
            aria-label="Tutup dialog"
          >
            <X className="size-4" />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}

function DecisionDialog({ decision, onClose, onSave }: { decision?: Decision; onClose: () => void; onSave: (decision: Decision) => void }) {
  const [errors, setErrors] = useState<string[]>([]);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setErrors(saveDecisionForm(form, decision, new Date().toISOString(), decision?.id ?? uid("decision"), onSave));
  }
  return (
    <DialogFrame
      title={decision ? "Edit local decision" : "Create local decision"}
      description="Tersimpan hanya di browser ini. Jangan masukkan PHI atau data pasien."
      onClose={onClose}
    >
      <form onSubmit={submit} className="grid gap-4 p-5">
        {errors.length > 0 && (
          <div role="alert" aria-live="assertive" className="rounded-lg bg-[var(--danger-soft)] p-3 text-sm text-[var(--danger)]">
            <strong>Periksa kembali:</strong>
            <ul className="mt-1 list-disc pl-5">
              {errors.map((error) => (
                <li key={error}>{error}</li>
              ))}
            </ul>
          </div>
        )}
        <Field label="Issue title" name="title" defaultValue={decision?.title} maxLength={120} required />
        <div className="grid gap-4 sm:grid-cols-3">
          <SelectField
            label="Priority"
            name="priority"
            defaultValue={decision?.priority ?? "medium"}
            options={["critical", "high", "medium", "low"]}
          />
          <Field label="Owner" name="owner" defaultValue={decision?.owner} required />
          <Field label="Due date" name="dueDate" type="date" defaultValue={decision?.dueDate} required />
        </div>
        <label className="grid gap-1.5 text-sm font-medium">
          Recommendation
          <textarea
            name="recommendation"
            defaultValue={decision?.recommendation}
            required
            maxLength={600}
            rows={5}
            className="resize-y rounded-lg border border-[var(--line)] p-3 font-normal outline-none"
          />
        </label>
        <div className="rounded-lg border border-warn-line bg-[var(--warn-soft)] p-3 text-xs leading-relaxed text-[var(--warn)]">
          <strong>No PHI.</strong> Jangan gunakan nama pasien, NIK, nomor rekam medis, tanggal lahir, diagnosis, atau catatan klinis.
        </div>
        <footer className="flex justify-end gap-2 border-t border-[var(--line)] pt-4">
          <button type="button" onClick={onClose} className="h-11 rounded-lg border border-[var(--line)] px-4 text-sm font-medium">
            Cancel
          </button>
          <button type="submit" className="h-11 rounded-lg bg-[var(--accent)] px-4 text-sm font-semibold text-white">
            Save local decision
          </button>
        </footer>
      </form>
    </DialogFrame>
  );
}

function Field({
  label,
  name,
  type = "text",
  defaultValue,
  maxLength,
  required,
}: {
  label: string;
  name: string;
  type?: string;
  defaultValue?: string;
  maxLength?: number;
  required?: boolean;
}) {
  return (
    <label className="grid gap-1.5 text-sm font-medium">
      {label}
      <input
        name={name}
        type={type}
        defaultValue={defaultValue}
        maxLength={maxLength}
        required={required}
        className="h-11 rounded-lg border border-[var(--line)] px-3 font-normal outline-none"
      />
    </label>
  );
}

function SelectField({ label, name, defaultValue, options }: { label: string; name: string; defaultValue: string; options: string[] }) {
  return (
    <label className="grid gap-1.5 text-sm font-medium">
      {label}
      <select
        name={name}
        defaultValue={defaultValue}
        className="h-11 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 font-normal outline-none"
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option.charAt(0).toUpperCase() + option.slice(1)}
          </option>
        ))}
      </select>
    </label>
  );
}

function ResolveDialog({ decision, onClose, onResolve }: { decision: Decision; onClose: () => void; onResolve: (reason: string) => void }) {
  const [error, setError] = useState("");
  return (
    <DialogFrame
      title="Resolve local decision"
      description="Menutup item lokal saja; bukan approval atau bukti eksekusi."
      onClose={onClose}
    >
      <form
        className="grid gap-4 p-5"
        onSubmit={(event) => {
          event.preventDefault();
          const reason = String(new FormData(event.currentTarget).get("reason") ?? "").trim();
          if (!reason) {
            setError("Alasan resolusi wajib diisi.");
            return;
          }
          onResolve(reason);
        }}
      >
        <div className="rounded-lg bg-[var(--surface-soft)] p-3 text-sm">
          <strong>{decision.title}</strong>
          <p className="mt-1 text-[var(--muted)]">{decision.recommendation}</p>
        </div>
        {error && (
          <p role="alert" className="text-sm text-[var(--danger)]">
            {error}
          </p>
        )}
        <label className="grid gap-1.5 text-sm font-medium">
          Resolution reason
          <textarea
            name="reason"
            rows={4}
            maxLength={400}
            className="rounded-lg border border-[var(--line)] p-3 font-normal outline-none"
          />
        </label>
        <footer className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="h-11 rounded-lg border border-[var(--line)] px-4 text-sm font-medium">
            Cancel
          </button>
          <button type="submit" className="h-11 rounded-lg bg-[var(--good)] px-4 text-sm font-semibold text-white">
            Resolve locally
          </button>
        </footer>
      </form>
    </DialogFrame>
  );
}

function BriefingDialog({ data, decisions, onClose }: { data: DashboardData; decisions: Decision[]; onClose: () => void }) {
  const preview = createBriefingPreview(data.validation, decisions, new Date().toISOString());
  return (
    <DialogFrame title={preview.title} description={preview.limitation} onClose={onClose}>
      <div className="grid gap-4 p-5">
        <div className="rounded-xl border border-[var(--line)] bg-[var(--surface-soft)] p-4">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <ShieldCheck className="size-4 text-[var(--good)]" />
            Format & governance snapshot
          </div>
          <p className="mt-2 text-sm text-[var(--muted)]">{preview.validationLine}</p>
        </div>
        <section>
          <h3 className="text-sm font-semibold tracking-[.1em] text-[var(--muted)]">Decisions requiring attention</h3>
          <div className="mt-2 grid gap-2">
            {preview.decisions.length ? (
              preview.decisions.map((decision) => (
                <article key={decision.id} className="rounded-xl border border-[var(--line)] p-4">
                  <div className="flex items-center gap-2">
                    <PriorityBadge priority={decision.priority} />
                    <span className="ml-auto text-xs text-[var(--muted)]">Due {formatDate(decision.dueDate)}</span>
                  </div>
                  <strong className="mt-2 block text-base">{decision.title}</strong>
                  <p className="mt-1 text-sm text-[var(--muted)]">{decision.recommendation}</p>
                </article>
              ))
            ) : (
              <p className="rounded-xl border border-dashed border-[var(--line)] p-6 text-center text-sm text-[var(--muted)]">
                Tidak ada local decision aktif.
              </p>
            )}
          </div>
        </section>
        <footer className="flex items-center justify-between border-t border-[var(--line)] pt-4 text-xs text-[var(--muted)]">
          <span>Generated {new Date(preview.generatedAt).toLocaleString("id-ID")}</span>
          <button type="button" onClick={onClose} className="h-11 rounded-lg bg-[var(--accent)] px-4 text-sm font-semibold text-white">
            Close preview
          </button>
        </footer>
      </div>
    </DialogFrame>
  );
}
