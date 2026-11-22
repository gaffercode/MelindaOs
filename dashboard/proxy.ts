import { NextRequest, NextResponse } from "next/server";
import { requirePrincipal } from "./lib/access/access-api";
import { hasPermission, landingFor, permissionFor, type Principal } from "./lib/access/access-control";
import { DirectorApiError } from "./lib/director/director-api";
import { protectedDirectorMode, safeReturnPath } from "./lib/director/director-auth";

const NO_STORE = { "Cache-Control": "private, no-store" };

/** `null` when the principal may open the page; otherwise where to send it (spec section 8). */
function forbiddenTarget(principal: Principal, pathname: string): string | null {
  if (hasPermission(principal, permissionFor(pathname))) return null;
  return principal.mustChange ? "/ganti-password" : landingFor(principal.role);
}

/**
 * All files under public/kredensial are governed here, not just the React page.
 * The guard is deliberately before filesystem/static-file routing.
 * A missing auth store fails CLOSED in production.
 */
export async function proxy(request: NextRequest) {
  if (!protectedDirectorMode()) return NextResponse.next();
  if (!request.nextUrl.pathname.startsWith("/kredensial")) return directorPage(request);
  const isPage = request.nextUrl.pathname === "/kredensial" || request.nextUrl.pathname === "/kredensial/";
  let principal: Principal;
  try {
    ({ principal } = await requirePrincipal(request));
  } catch {
    if (isPage) {
      const login = new URL("/director-login", request.url);
      login.searchParams.set("returnTo", "/kredensial");
      return NextResponse.redirect(login, { headers: { "Cache-Control": "private, no-store" } });
    }
    return new NextResponse("Silakan masuk.", {
      status: 401,
      headers: { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow" },
    });
  }
  const target = forbiddenTarget(principal, request.nextUrl.pathname);
  if (target && isPage) return NextResponse.redirect(new URL(target, request.url), { headers: NO_STORE });
  if (target) {
    return new NextResponse("Akses tidak sesuai peran.", {
      status: 403,
      headers: { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow" },
    });
  }
  const response = NextResponse.next();
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  return response;
}
/**
 * Director pages stream a loading skeleton, so a page-level redirect() would arrive after a 200.
 * Full page loads are checked here first so a signed-out visitor gets a real 307 and no skeleton.
 * Client navigations and prefetches (RSC requests) skip this and keep the page guard only.
 */
async function directorPage(request: NextRequest) {
  if (request.headers.has("rsc")) return NextResponse.next();
  let principal: Principal;
  try {
    ({ principal } = await requirePrincipal(request));
  } catch (error) {
    if (!(error instanceof DirectorApiError && error.status === 401)) return NextResponse.next();
    const login = new URL("/director-login", request.url);
    login.searchParams.set("returnTo", safeReturnPath(request.nextUrl.pathname + request.nextUrl.search));
    return NextResponse.redirect(login, { headers: { "Cache-Control": "private, no-store" } });
  }
  const target = forbiddenTarget(principal, request.nextUrl.pathname);
  return target ? NextResponse.redirect(new URL(target, request.url), { headers: NO_STORE }) : NextResponse.next();
}

export const config = {
  // <generated:matcher>
  matcher: [
    "/",
    "/overview",
    "/knowledge",
    "/integrations",
    "/director-review",
    "/kredensial",
    "/kredensial/:path*",
    "/casemix",
    "/hrd",
    "/order-obat",
    "/formularium",
    "/starkes",
    "/crm",
    "/berita",
    "/ruang-kerja",
    "/ganti-password",
    "/studio",
    "/arahan",
    "/arahan/arsip",
    "/arahan/persiapan",
    "/melinda",
    "/klinis",
    "/pengguna",
    "/isian-dokumen",
    "/rujukan-masuk",
    "/satu-sehat",
  ],
  // </generated:matcher>
};
