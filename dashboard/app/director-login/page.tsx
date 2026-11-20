import type { Metadata } from "next";
import { DirectorLogin } from "@/components/director/director-login";
import { authConfiguration, safeReturnPath } from "@/lib/director/director-auth";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Masuk | MelindaOS", robots: { index: false, follow: false } };
export default async function LoginPage({ searchParams }: { searchParams: Promise<{ returnTo?: string | string[] }> }) {
  let available = false;
  try { available = Boolean(authConfiguration()); } catch { available = false; }
  return <DirectorLogin available={available} returnTo={safeReturnPath((await searchParams).returnTo)} />;
}
