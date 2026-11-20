// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DirectorLogin } from "@/components/director/director-login";
import { LOGO_ORANGE, LOGO_PATHS, LOGO_TEAL } from "@/components/entrance/melinda-logo";

describe("DirectorLogin", () => {
  it("is a Director-only form: no role picker, exactly one passcode field", () => {
    const html = renderToStaticMarkup(<DirectorLogin available returnTo="/starkes" />);
    expect(html).not.toContain('type="radio"');
    expect(html.match(/type="password"/g)).toHaveLength(1);
    expect(html).toMatch(/<label[^>]*for="director-passcode"[^>]*>Passcode<\/label>/);
    expect(html).toContain("Connecting hospital knowledge with the daily work and decisions that shape patient care.");
    expect(html).toContain('autoComplete="current-password"');
    expect(html).toMatch(/<button[^>]*type="submit"/);
  });

  it("draws the brand mark as inline SVG geometry in the original colours, with no video or raster hero", () => {
    const html = renderToStaticMarkup(<DirectorLogin available returnTo="/" />);
    expect(html).toContain(`<path data-reveal="left" d="${LOGO_PATHS.left}" fill="${LOGO_ORANGE}"`);
    expect(html).toContain(`<path data-reveal="right" d="${LOGO_PATHS.right}" fill="${LOGO_TEAL}"`);
    expect(html).toContain('data-reveal="oval"');
    expect(html).toContain('data-reveal="dot"');
    expect(LOGO_ORANGE).toBe("#ff7229");
    expect(LOGO_TEAL).toBe("#0cb4b6");
    expect(html).not.toContain("<video");
    expect(html).not.toContain("<img");
  });

  it("starts as a white frame: every animated part is server-rendered at opacity 0", () => {
    const html = renderToStaticMarkup(<DirectorLogin available returnTo="/" />);
    for (const part of ['data-reveal="left"', 'data-reveal="right"', 'data-entrance="welcome"', 'data-entrance="field"', 'data-entrance="attribution"']) {
      expect(html, part).toMatch(new RegExp(`${part}[^>]*style="opacity:0"`));
    }
  });

  it("carries the exact attribution lines and the passcode reveal toggle", () => {
    const html = renderToStaticMarkup(<DirectorLogin available returnTo="/" />);
    expect(html).toContain("<p>Sentra Artificial Intelligence 2026</p>");
    expect(html).toMatch(/<button type="button"[^>]*aria-label="Tampilkan passcode"[^>]*aria-pressed="false"/);
    expect(html).not.toContain('role="button"');
    expect(html).not.toContain("tabindex");
  });

  it("shows the brand lockup beside the logo: name, full tagline, credit", () => {
    const html = renderToStaticMarkup(<DirectorLogin available returnTo="/" />);
    expect(html).toMatch(/data-entrance="brand-name"[^>]*style="opacity:0">Melinda OS</);
    expect(html).toMatch(/data-entrance="brand-tagline"[^>]*style="opacity:0">Institutional Intelligent Layer</);
    expect(html).toMatch(/data-entrance="brand-credit"[^>]*style="opacity:0">Architect and built by dr\. Ferdi Andriska\.</);
    expect(html.indexOf('data-entrance="logo"')).toBeLessThan(html.indexOf('data-entrance="brand-name"'));
    expect(html.indexOf('data-entrance="brand-name"')).toBeLessThan(html.indexOf('data-entrance="brand-tagline"'));
    expect(html.indexOf('data-entrance="brand-tagline"')).toBeLessThan(html.indexOf('data-entrance="brand-credit"'));
  });

  it("puts a decorative cat inside the field row, hidden below the field's edge until the timeline peeks it out", () => {
    const html = renderToStaticMarkup(<DirectorLogin available returnTo="/" />);
    expect(html).toMatch(/<div class="entrance-control"><span class="entrance-cat" aria-hidden="true"><span class="entrance-cat-body" data-cat-body="" style="transform:translateY\(105%\)"><svg/);
    expect(html.indexOf('class="entrance-cat"')).toBeLessThan(html.indexOf('id="director-passcode"'));
  });

  it("disables the field and shows the configuration message when login is unavailable", () => {
    const html = renderToStaticMarkup(<DirectorLogin available={false} returnTo="/" />);
    expect(html).toMatch(/<input[^>]*id="director-passcode"[^>]*disabled=""/);
    expect(html).toContain("Layanan login belum dikonfigurasi.");
  });
});

describe("DirectorLogin account choice", () => {
  const assign = vi.fn();
  let calls: { url: string; init: RequestInit }[];
  let reply: () => Promise<Response>;
  beforeEach(() => {
    calls = []; assign.mockReset();
    reply = () => Promise.resolve(Response.json({ returnTo: "/ruang-kerja", csrfToken: "c", role: "STAFF_FINANCE", mustChange: false }));
    vi.stubGlobal("fetch", vi.fn((url: string, init: RequestInit) => { calls.push({ url, init }); return reply(); }));
    vi.stubGlobal("location", { assign });
    vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: () => undefined, removeEventListener: () => undefined }));
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  const choose = (name: string) => fireEvent.click(screen.getByRole("button", { name }));
  const passcodeForm = () => screen.getByLabelText("Passcode", { selector: "input" }).closest("form");
  const submitAccount = (email = " dewi@example.test ", password = "kata-example-12345") => {
    choose("Akun");
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: email } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: password } });
    fireEvent.click(screen.getByRole("button", { name: "Masuk" }));
  };

  it("offers Direktur (selected) and Akun, and shows no email or password field until Akun is chosen", () => {
    render(<DirectorLogin available returnTo="/starkes" />);
    expect(screen.getByRole("button", { name: "Direktur" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Akun" }).getAttribute("aria-pressed")).toBe("false");
    expect(screen.queryByLabelText("Email")).toBeNull();
    expect(screen.queryByLabelText("Password")).toBeNull();
  });

  it("choosing Akun shows Email and Password and hides the passcode form, and back again", () => {
    render(<DirectorLogin available returnTo="/" />);
    choose("Akun");
    expect(screen.getByLabelText("Email")).toBeTruthy();
    expect(screen.getByLabelText("Password")).toBeTruthy();
    expect(passcodeForm()?.hidden).toBe(true);
    choose("Direktur");
    expect(passcodeForm()?.hidden).toBe(false);
    expect(screen.getByLabelText("Email").closest("form")?.hidden).toBe(true);
  });

  it("posts { email, password, returnTo } to /api/access/session and opens the returned path", async () => {
    render(<DirectorLogin available returnTo="/casemix" />);
    submitAccount();
    await waitFor(() => expect(assign).toHaveBeenCalledWith("/ruang-kerja"));
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("/api/access/session");
    expect(calls[0].init.method).toBe("POST");
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ email: "dewi@example.test", password: "kata-example-12345", returnTo: "/casemix" });
  });

  it("shows the server's message when the sign-in is refused, and does not navigate", async () => {
    reply = () => Promise.resolve(Response.json({ error: "Email atau password tidak sesuai." }, { status: 401 }));
    render(<DirectorLogin available returnTo="/" />);
    submitAccount();
    expect((await screen.findByRole("alert")).textContent).toBe("Email atau password tidak sesuai.");
    expect(assign).not.toHaveBeenCalled();
  });

  it("shows a fixed Indonesian message when the server cannot be reached", async () => {
    reply = () => Promise.reject(new TypeError("Failed to fetch"));
    render(<DirectorLogin available returnTo="/" />);
    submitAccount();
    expect((await screen.findByRole("alert")).textContent).toBe("Tidak dapat menghubungi server. Coba lagi.");
    expect(assign).not.toHaveBeenCalled();
  });

  it("leaves the Director passcode path on /api/director/session with { passcode, returnTo }", async () => {
    reply = () => Promise.resolve(Response.json({ returnTo: "/starkes" }));
    render(<DirectorLogin available returnTo="/starkes" />);
    fireEvent.change(screen.getByLabelText("Passcode", { selector: "input" }), { target: { value: "rahasia" } });
    fireEvent.click(screen.getByRole("button", { name: "Masuk" }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith("/starkes"), { timeout: 3000 });
    expect(calls[0].url).toBe("/api/director/session");
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ passcode: "rahasia", returnTo: "/starkes" });
  });
});
