import type { NextConfig } from "next";
import traceManifest from "./scripts/trace-manifest.json";

const isDev = process.env.NODE_ENV === "development";

const contentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data: https:",
  "media-src 'self'",
  "font-src 'self'",
  "connect-src 'self'",
  "frame-src 'self' blob: https://*.supabase.co",
  "object-src 'self' blob: data:",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
].join("; ");

const securityHeaders = [
  // Only inject strict CSP in production/test. In local development, Turbopack HMR and DevTools
  // require unconstrained local WebSocket connections to prevent client reload loops.
  ...(isDev ? [] : [{ key: "Content-Security-Policy", value: contentSecurityPolicy }]),
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

// The PDF.js viewer page only: it loads pdf.js from cdnjs and fetches the signed Storage URL the API redirects to.
const kredensialViewerHeaders = [
  { key: "Cache-Control", value: "private, no-store, max-age=0" },
  { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com",
      "style-src 'self' 'unsafe-inline'",
      "connect-src 'self' https://cdnjs.cloudflare.com https://*.supabase.co",
      "worker-src 'self' blob: https://cdnjs.cloudflare.com",
      "img-src 'self' blob: data:",
      "frame-ancestors 'self'",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  experimental: {
    agentUpgrade: "security",
  },
  // pdfjs reads Order obat sheets on the server; bundling it breaks its worker-less legacy build.
  serverExternalPackages: ["pdfjs-dist"],
  // Keys are route globs. The map lives in scripts/trace-manifest.json, the single source shared
  // with scripts/trace-budget.mjs (a bare [id] is a character class, so dynamic segments are escaped there).
  outputFileTracingIncludes: traceManifest.nextIncludes,
  async headers() {
    return [
      { source: "/(.*)", headers: securityHeaders },
      { source: "/kredensial/pdf-viewer.html", headers: kredensialViewerHeaders },
    ];
  },
};

export default nextConfig;
