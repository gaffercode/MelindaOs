"use client";

import { ExternalLink, ImageOff, RefreshCcw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  bufferServiceLabel,
  bufferStatusLabel,
  formatBufferDueAt,
  groupBufferCreatives,
  type BufferCreativeGroup,
  type BufferQueuePost,
  type BufferQueueSnapshot,
} from "@/lib/buffer";
import { LoadingState } from "./loading-state";

const CREATIVE_LIMIT = 8;

function emptySnapshot(message: string): BufferQueueSnapshot {
  return { status: "error", posts: [], counts: {}, message };
}

function countLine(outlets: BufferQueuePost[]): string {
  const scheduled = outlets.filter((item) => item.status === "scheduled").length;
  const draft = outlets.filter((item) => item.status === "draft").length;
  const approval = outlets.filter((item) => item.status === "needs_approval").length;
  const error = outlets.filter((item) => item.status === "error").length;
  const parts: string[] = [];
  if (scheduled) parts.push(`${scheduled} terjadwal`);
  if (draft) parts.push(`${draft} draf`);
  if (approval) parts.push(`${approval} persetujuan`);
  if (error) parts.push(`${error} gagal`);
  return parts.join(" · ") || `${outlets.length} kanal`;
}

function CreativeCard({ group }: { group: BufferCreativeGroup }) {
  return (
    <section className="buffer-card">
      <div className="buffer-card-top">
        <div className="buffer-card-media">
          {group.bannerUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={group.bannerUrl} alt="" loading="lazy" />
          ) : (
            <div className="buffer-card-media-empty">
              <ImageOff className="size-5" aria-hidden="true" />
              <span>Tanpa banner</span>
            </div>
          )}
        </div>
        <div className="buffer-card-copy">
          <p className="buffer-card-text">{group.text || "Tanpa teks"}</p>
          <p className="buffer-card-summary">{countLine(group.outlets)}</p>
        </div>
      </div>

      <ul className="buffer-card-channels">
        {group.outlets.map((outlet) => (
          <li key={outlet.id} className="buffer-channel-cell">
            <div className="buffer-channel-cell-head">
              {outlet.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={outlet.avatarUrl} alt="" />
              ) : (
                <span>{bufferServiceLabel(outlet.service).slice(0, 1)}</span>
              )}
              {outlet.profileUrl ? (
                <a
                  className="buffer-channel-link"
                  href={outlet.profileUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <strong>{bufferServiceLabel(outlet.service)}</strong>
                  <ExternalLink className="size-3.5" aria-hidden="true" />
                  <span className="sr-only">Buka profil</span>
                </a>
              ) : (
                <strong>{bufferServiceLabel(outlet.service)}</strong>
              )}
            </div>
            <span
              className={
                outlet.status === "error"
                  ? "buffer-channel-status is-error"
                  : outlet.status === "needs_approval"
                    ? "buffer-channel-status is-warn"
                    : outlet.status === "scheduled"
                      ? "buffer-channel-status is-scheduled"
                      : "buffer-channel-status"
              }
            >
              {bufferStatusLabel(outlet.status)}
            </span>
            <span className="buffer-channel-time">{formatBufferDueAt(outlet.dueAt)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function BufferQueuePanel() {
  const [snapshot, setSnapshot] = useState<BufferQueueSnapshot | null>(null);
  const [loading, setLoading] = useState(true);

  // `loading` starts true, so the mount effect does not call setState synchronously; manual
  // refreshes set it explicitly before loading (matches the pattern in dashboard-app.tsx).
  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch("/api/integrations/buffer", {
        cache: "no-store",
        signal,
      });
      const body = (await response.json().catch(() => null)) as BufferQueueSnapshot | null;
      if (!body || typeof body.status !== "string" || !Array.isArray(body.posts)) {
        setSnapshot(emptySnapshot("Respons Buffer tidak valid."));
        return;
      }
      setSnapshot(body);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setSnapshot(emptySnapshot("Gagal memuat antrian Buffer."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => void load(controller.signal), 0);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [load]);

  const allCreatives = useMemo(() => groupBufferCreatives(snapshot?.posts ?? []), [snapshot?.posts]);
  const creatives = allCreatives.slice(0, CREATIVE_LIMIT);
  const hidden = Math.max(0, allCreatives.length - CREATIVE_LIMIT);

  return (
    <article className="rounded-xl border border-[var(--line)] bg-[var(--surface)]">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-[var(--line)] p-5">
        <div>
          <span className="block text-sm text-[var(--muted)]">Media sosial</span>
          <strong className="block text-xl font-medium tracking-tight">Antrian Buffer</strong>
          <p className="mt-1 text-base text-[var(--muted)]">
            {snapshot?.status === "ok"
              ? `${snapshot.organizationName ?? "Buffer"} · 1 draf, status per sosmed`
              : snapshot?.status === "unconfigured"
                ? "Belum dikonfigurasi"
                : snapshot?.status === "error"
                  ? "Tidak tersedia"
                  : "Memuat…"}
          </p>
        </div>
        <button type="button" className="button-secondary" disabled={loading} onClick={() => { setLoading(true); void load(); }}>
          <RefreshCcw className="size-4" />
          Perbarui
        </button>
      </div>

      {loading && !snapshot ? (
        <p className="m-0 p-6"><LoadingState label="Memuat antrian Buffer" /></p>
      ) : !snapshot || snapshot.status === "unconfigured" ? (
        <p className="p-6 text-base text-[var(--muted)]">
          {snapshot?.message ?? "Memuat antrian Buffer…"}{" "}
          {snapshot?.status === "unconfigured" ? "Tambahkan key, lalu jalankan ulang server lokal." : null}
        </p>
      ) : snapshot.status === "error" ? (
        <p role="alert" className="p-6 text-base text-[var(--orange-ink)]">
          {snapshot.message || "Antrian Buffer tidak tersedia."}
        </p>
      ) : creatives.length === 0 ? (
        <p className="p-6 text-base text-[var(--muted)]">Belum ada unggahan di antrian Buffer.</p>
      ) : (
        <div className="buffer-stack">
          {creatives.map((group) => (
            <CreativeCard key={group.key} group={group} />
          ))}
          {hidden > 0 ? <p className="buffer-stack-more">+{hidden} draf lain di Buffer</p> : null}
        </div>
      )}
    </article>
  );
}
