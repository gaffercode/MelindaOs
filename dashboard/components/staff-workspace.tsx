"use client";

import { type FormEvent, useState } from "react";
import Link from "next/link";
import { KeyRound, Search } from "lucide-react";
import { ROLE_LABELS, type PublicPrincipal } from "@/lib/access/access-control";
import { fetchSearch } from "@/lib/client-api";
import type { SearchResult } from "@/lib/contracts";
import { AskMelinda } from "@/components/ask-melinda";
import { PAGE_LABELS } from "@/components/shell";

const NOT_A_MODULE = ["/ruang-kerja", "/ganti-password"];

/** Landing page for staff accounts: the modules their role may open, plus Tanya Melinda and document search. No executive figures. */
export function StaffWorkspace({ principal, allowedPages }: { principal: PublicPrincipal; allowedPages: string[] }) {
  const modules = allowedPages.filter((page) => !NOT_A_MODULE.includes(page) && PAGE_LABELS[page]);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [error, setError] = useState("");
  const [searching, setSearching] = useState(false);

  async function search(event: FormEvent) {
    event.preventDefault();
    const term = query.trim();
    if (!term || searching) return;
    setSearching(true); setError("");
    try { setResults(await fetchSearch(term)); } catch (caught: unknown) { setResults(null); setError(caught instanceof Error ? caught.message : "Pencarian gagal. Coba lagi."); } finally { setSearching(false); }
  }

  return <>
    <header>
      <h1 className="m-0 text-[length:var(--type-title)] font-medium">Selamat datang, {principal.displayName}</h1>
      <p className="m-0 mt-1 text-[var(--muted)]">{ROLE_LABELS[principal.role]}</p>
    </header>
    <section aria-labelledby="staff-modules-title">
      <h2 id="staff-modules-title" className="m-0 mb-3 text-[length:var(--type-title-sm)] font-medium">Modul Anda</h2>
      <ul className="m-0 grid list-none gap-3 p-0 sm:grid-cols-2 xl:grid-cols-3">
        {modules.map((page) => <li key={page}>
          <Link href={page} className="block rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4 font-medium hover:border-[var(--accent)]">{PAGE_LABELS[page]}</Link>
        </li>)}
      </ul>
    </section>
    <AskMelinda linkSources={false} />
    <section aria-labelledby="staff-search-title" className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4">
      <h2 id="staff-search-title" className="m-0 text-[length:var(--type-title-sm)] font-medium">Cari dokumen</h2>
      <form onSubmit={search} className="mt-3 flex gap-2">
        <label htmlFor="staff-search" className="sr-only">Kata kunci dokumen</label>
        <div className="flex h-11 min-w-0 flex-1 items-center gap-2 rounded-lg border border-[var(--line)] px-3">
          <Search className="size-4 text-[var(--muted)]" aria-hidden="true" />
          <input id="staff-search" value={query} onChange={(event) => setQuery(event.target.value)} maxLength={120} placeholder="Contoh: SPO identifikasi pasien" className="min-w-0 flex-1 outline-none" />
        </div>
        <button type="submit" disabled={searching || !query.trim()} className="h-11 rounded-lg bg-[var(--accent)] px-4 font-medium text-white disabled:opacity-60">Cari</button>
      </form>
      {error && <p role="alert" className="m-0 mt-3 text-[var(--warn)]">{error}</p>}
      {results && (results.length === 0
        ? <p role="status" className="m-0 mt-3 text-[var(--muted)]">Tidak ada dokumen yang cocok.</p>
        : <ul className="m-0 mt-3 grid list-none gap-2 p-0">
          {results.map((result) => <li key={result.path} className="rounded-xl border border-[var(--line)] p-3">
            <strong>{result.title}</strong>
            <p className="m-0 mt-1 text-[var(--muted)]">{result.snippet}</p>
          </li>)}
        </ul>)}
    </section>
    <p className="m-0"><Link href="/ganti-password" className="inline-flex items-center gap-2 text-[var(--accent)] underline-offset-2 hover:underline"><KeyRound className="size-4" aria-hidden="true" />Ganti password</Link></p>
  </>;
}
