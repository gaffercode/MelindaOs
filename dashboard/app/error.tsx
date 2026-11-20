"use client";

export default function Error({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <main className="grid min-h-dvh place-items-center p-6">
    <section role="alert" className="max-w-md rounded-xl border border-[var(--danger)] bg-[var(--danger-soft)] p-5 text-base">
      <h1 className="text-lg font-medium">Layanan sementara tidak tersedia</h1>
      <p className="mt-2">Dashboard tidak dapat memverifikasi sesi atau memuat data. Coba lagi beberapa saat lagi; bila berulang, hubungi administrator{error.digest ? ` dengan kode ${error.digest}` : ""}.</p>
      <button type="button" className="button-secondary mt-4" onClick={() => retry()}>Coba lagi</button>
    </section>
  </main>;
}
