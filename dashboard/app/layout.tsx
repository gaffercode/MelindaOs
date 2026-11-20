import type { Metadata } from "next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { DecisionProvider } from "@/components/decision/decision-provider";
import { LocalModeBanner } from "@/components/local-mode-banner";
import { WelcomeVeil } from "@/components/welcome-veil";
import { ENTRANCE_SCRIPT } from "@/lib/entrance-flag";
import { WELCOME_SCRIPT, WELCOME_TEXT } from "@/lib/welcome-flag";
import "./globals.css";

export const metadata: Metadata = {
  title: "MelindaOS Command Pulse",
  description: "Local control plane for MelindaOS institutional intelligence",
  icons: { icon: "/brand/melindaos-logo.png" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    // Two inline scripts set attributes on <html> before paint, hence suppressHydrationWarning: data-entrance (once-per-session
    // signature moment) and, right after a Director sign-in, data-welcome. The welcome one sits in <head>: the veil is drawn by
    // <html>'s own pseudo-elements, so it is on screen from the destination's first frame, before any of <body> has arrived.
    // Its type follows Next's "Preventing flash before hydration" guide: executable from the server, inert if React ever renders it on the client.
    <html lang="id" data-welcome-text={WELCOME_TEXT} suppressHydrationWarning>
      <head><script type={typeof window === "undefined" ? "text/javascript" : "text/plain"} suppressHydrationWarning dangerouslySetInnerHTML={{ __html: WELCOME_SCRIPT }} /></head>
      <body><LocalModeBanner /><script type={typeof window === "undefined" ? "text/javascript" : "text/plain"} suppressHydrationWarning dangerouslySetInnerHTML={{ __html: ENTRANCE_SCRIPT }} /><WelcomeVeil /><DecisionProvider>{children}</DecisionProvider><SpeedInsights /></body>
    </html>
  );
}
