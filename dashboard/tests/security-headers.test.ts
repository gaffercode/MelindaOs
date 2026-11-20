import { describe, expect, it } from "vitest";
import nextConfig from "@/next.config";

describe("security headers", () => {
  it("applies CSP, clickjacking and transport protections to every route", async () => {
    const rules = await nextConfig.headers!();
    expect(rules.length).toBeGreaterThanOrEqual(1);
    expect(rules[0].source).toBe("/(.*)");
    const headers = Object.fromEntries(rules[0].headers.map(({ key, value }) => [key, value]));
    expect(headers["Content-Security-Policy"]).toContain("default-src 'self'");
    expect(headers["Content-Security-Policy"]).toContain("frame-ancestors 'self'");
    expect(headers["Content-Security-Policy"]).toContain("object-src 'self'");
    expect(headers["Content-Security-Policy"]).toContain("img-src 'self' blob: data: https:");
    expect(headers["X-Frame-Options"]).toBe("SAMEORIGIN");
    expect(headers["Strict-Transport-Security"]).toMatch(/^max-age=\d+/);

    if (rules.length > 1) {
      expect(rules[1].source).toBe("/kredensial/pdf-viewer.html");
      const kredHeaders = Object.fromEntries(rules[1].headers.map(({ key, value }) => [key, value]));
      expect(kredHeaders["X-Frame-Options"]).toBe("SAMEORIGIN");
      expect(kredHeaders["Cache-Control"]).toContain("no-store");
      expect(kredHeaders["X-Robots-Tag"]).toContain("noindex");
      expect(kredHeaders["Access-Control-Allow-Origin"]).toBeUndefined();
      expect(kredHeaders["Content-Security-Policy"]).toContain("connect-src 'self' https://cdnjs.cloudflare.com https://*.supabase.co");
      expect(kredHeaders["Content-Security-Policy"]).not.toContain("default-src *");
    }
  });

  it("allows no eval and no loopback connections in the production CSP, and leaves the viewer CSP alone", async () => {
    const rules = await nextConfig.headers!();
    const csp = (index: number) => rules[index].headers.find(({ key }) => key === "Content-Security-Policy")!.value;
    const directives = Object.fromEntries(csp(0).split("; ").map((d) => [d.split(" ")[0], d]));
    expect(directives["script-src"]).toBe("script-src 'self' 'unsafe-inline'");
    expect(directives["connect-src"]).toBe("connect-src 'self'");
    expect(directives["frame-src"]).toBe("frame-src 'self' blob: https://*.supabase.co");
    expect(csp(0)).not.toMatch(/unsafe-eval|127\.0\.0\.1|localhost|ws:/);
    expect(csp(1)).toBe([
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com",
      "style-src 'self' 'unsafe-inline'",
      "connect-src 'self' https://cdnjs.cloudflare.com https://*.supabase.co",
      "worker-src 'self' blob: https://cdnjs.cloudflare.com",
      "img-src 'self' blob: data:",
      "frame-ancestors 'self'",
    ].join("; "));
  });
});
