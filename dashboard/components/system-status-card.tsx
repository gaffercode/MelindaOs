import { readSystemStatus, type DatabaseCause } from "@/lib/ops-alerts";

const CAUSE_TEXT: Record<DatabaseCause, string> = {
  unauthorized: "Kunci database ditolak. Periksa kunci Supabase di pengaturan Vercel.",
  missing_function: "Fungsi database belum terpasang. Jalankan pembaruan database yang belum dijalankan.",
  unreachable: "Database tidak dapat dihubungi. Coba lagi beberapa saat.",
  unknown: "Status sistem tidak dapat diperiksa saat ini.",
};

/** Server component: shows today's operational findings and missing migrations; renders nothing when all is well. */
export async function SystemStatusCard({ date }: { date: string }) {
  const status = await readSystemStatus(date);
  if (!status) return null;
  const { checks, ledger, missingMigrations, medifyReceiver } = status;
  const listMigrations = ledger === "ok" && missingMigrations.length > 0;
  if (checks.state === "ok" && ledger !== "not_installed" && !listMigrations && medifyReceiver === "configured") return null;
  return (
    <section className="system-status" role="status" aria-label="Status sistem">
      {medifyReceiver === "not_configured" && <p>Penerima data Medify belum dikonfigurasi.</p>}
      {checks.state === "unavailable" && <p>{CAUSE_TEXT[checks.cause]}</p>}
      {ledger === "not_installed" && <p>Pemeriksa pembaruan database belum terpasang. Jalankan <code>{missingMigrations[0]}</code> di SQL Editor Supabase.</p>}
      {listMigrations && (
        <>
          <p>{missingMigrations.length} pembaruan database belum dijalankan, urut dari atas:</p>
          <ul>
            {missingMigrations.map((name) => <li key={name}><code>{name}</code></li>)}
          </ul>
        </>
      )}
      {checks.state === "alerts" && (
        <>
          <p>Status sistem: {checks.alerts.length} hal perlu diperiksa.</p>
          <ul>
            {checks.alerts.map((alert) => <li key={`${alert.code}:${alert.detail}`}>{alert.detail}</li>)}
          </ul>
        </>
      )}
    </section>
  );
}
