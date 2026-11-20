import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { requirePrincipal } from "../access/access-api";
import { allowedPages, hasPermission, landingFor, permissionFor, type Principal } from "../access/access-control";
import { protectedDirectorMode, safeReturnPath, SESSION_COOKIE, USER_COOKIE } from "./director-auth";
import { DirectorApiError, requireConfiguration, requireHuman } from "./director-api";
import { logError } from "../log";

export async function requireDirectorPage(returnTo: string): Promise<boolean> {
  const session = await readDirectorPageSession(returnTo);
  return session.authenticated;
}

export async function readDirectorPageSession(returnTo: string): Promise<{ authenticated: boolean }> {
  if (!protectedDirectorMode()) return { authenticated: false };
  try {
    const config = requireConfiguration();
    const value = (await cookies()).get(SESSION_COOKIE)?.value;
    await requireHuman(
      new Request(`${config.origin}/`, { headers: value ? { Cookie: `${SESSION_COOKIE}=${value}` } : {} }),
      config
    );
    return { authenticated: true };
  } catch (error) {
    if (error instanceof DirectorApiError && error.status === 401) {
      redirect(`/director-login?returnTo=${encodeURIComponent(safeReturnPath(returnTo))}`);
    }
    logError("director_page_auth", error);
    throw error;
  }
}

/**
 * Any signed-in principal (Director or account) for a page. 401 goes to sign-in, a role without the page's permission
 * to `landingFor(role)`, and an account that must change its password to `/ganti-password` (spec section 8).
 * In local file mode there is no principal and every page is listed, as `readDirectorPageSession` does today.
 */
export async function requirePagePermission(path: string): Promise<{ authenticated: boolean; principal: Principal | null; allowedPages: string[] }> {
  if (!protectedDirectorMode()) return { authenticated: false, principal: null, allowedPages: allowedPages({ role: "DIRECTOR", mustChange: false }) };
  let principal: Principal;
  try {
    const config = requireConfiguration();
    const store = await cookies();
    const cookie = [SESSION_COOKIE, USER_COOKIE].flatMap((name) => {
      const value = store.get(name)?.value;
      return value ? [`${name}=${value}`] : [];
    }).join("; ");
    ({ principal } = await requirePrincipal(new Request(`${config.origin}/`, { headers: cookie ? { Cookie: cookie } : {} }), config));
  } catch (error) {
    if (error instanceof DirectorApiError && error.status === 401) {
      redirect(`/director-login?returnTo=${encodeURIComponent(safeReturnPath(path))}`);
    }
    logError("access_page_auth", error);
    throw error;
  }
  if (!hasPermission(principal, permissionFor(path))) redirect(principal.mustChange ? "/ganti-password" : landingFor(principal.role));
  return { authenticated: true, principal, allowedPages: allowedPages(principal) };
}
