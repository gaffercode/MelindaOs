"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Bell } from "lucide-react";
import { NotificationBell } from "@/components/ui/notification-bell";

/**
 * Tasks that wait for the Director right now: `kendala` (staff reported a blocker) plus `escalated` (no reply after two
 * reminders), read from the same board endpoint as /arahan. Read once per page and again when the tab becomes visible;
 * no polling. Unreachable board (file mode, 401, 503) leaves the count unknown, so no badge is invented.
 */
export function useDirectorAttention(enabled: boolean): number | null {
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    const load = async () => {
      try {
        const response = await fetch("/api/director/tasks/board", { cache: "no-store", signal: controller.signal });
        if (!response.ok) return;
        const data = await response.json() as { summary?: { kendala?: number; escalated?: number } };
        if (data.summary) setCount((data.summary.kendala ?? 0) + (data.summary.escalated ?? 0));
      } catch { /* aborted or unreachable: keep the last known count */ }
    };
    void load();
    const onVisible = () => { if (document.visibilityState === "visible") void load(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { controller.abort(); document.removeEventListener("visibilitychange", onVisible); };
  }, [enabled]);
  return count;
}

/**
 * Header bell: Rare UI NotificationBell (`asChild`) around the existing header link, so it stays a real link
 * (`href`: the decisions section on the executive page, the task board elsewhere) while the badge count rolls and springs in from real data.
 */
export function DirectorBell({ pending, authenticated, href }: { pending: number | null; authenticated: boolean; href: string }) {
  const attention = useDirectorAttention(authenticated);
  const total = (pending ?? 0) + (attention ?? 0);
  const label = total > 0 ? `${total} hal menunggu keputusan Direktur` : "Papan tugas Direktur";
  return <NotificationBell asChild size={34} count={total} color="red">
    <Link href={href} className="header-icon" aria-label={label} title={label}><Bell className="size-4" aria-hidden="true" /></Link>
  </NotificationBell>;
}
