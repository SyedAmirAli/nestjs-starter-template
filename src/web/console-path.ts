/**
 * Where the admin console lives, as seen by the browser.
 *
 * The SPA is mounted under `/admin` rather than `/`, so `/v1`, `/health` and the rest of
 * the API are ordinary Nest routes — they do not have to win a race against a catch-all.
 * Login is the one public path under that prefix; every other `/admin` navigation is gated.
 */

export const ADMIN_CONSOLE_BASE = '/admin';
export const ADMIN_LOGIN_PATH = '/admin/login';

function normalizePath(pathname: string): string {
    return pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
}

/** `/admin` itself and everything under it, including `/admin/login` and `/admin/assets/*`. */
export function isAdminConsolePath(pathname: string): boolean {
    const path = normalizePath(pathname);
    return path === ADMIN_CONSOLE_BASE || path.startsWith(`${ADMIN_CONSOLE_BASE}/`);
}

/** The sign-in screen. Served without a session so the SPA can collect credentials. */
export function isAdminLoginPath(pathname: string): boolean {
    return normalizePath(pathname) === ADMIN_LOGIN_PATH;
}

/**
 * Map a request path onto a file inside `web/dist`.
 *
 * Vite's `base` is `/admin/`, so the browser asks for `/admin/assets/index-….js` while the
 * file on disk is `dist/assets/index-….js`. Stripping the console prefix is what joins the
 * two. A path that is not under `/admin` is returned as a relative path unchanged — the
 * static handler should not be seeing those, but a leading-slash strip still keeps `sendFile`
 * from treating them as absolute.
 */
export function adminConsoleDistPath(pathname: string): string {
    const stripped = isAdminConsolePath(pathname) ? pathname.slice(ADMIN_CONSOLE_BASE.length) : pathname;
    return stripped.replace(/^\/+/, '');
}

/**
 * JS, CSS, source and Vite internals — everything the login page needs in order to boot.
 *
 * Dashboard document URLs (`/admin`, `/admin/system`, …) are *not* assets. Those stay
 * behind the session gate even when the request is an XHR rather than a navigation, so a
 * `fetch('/admin')` gets a JSON 401 instead of the SPA shell.
 */
const CONSOLE_ASSET_PREFIXES = ['assets/', '@vite', '@id', '@react-refresh', '@fs', 'src/', 'node_modules/'] as const;
const CONSOLE_PUBLIC_FILES = new Set(['favicon.svg', 'icons.svg']);

export function isConsoleAssetPath(pathname: string): boolean {
    const relative = adminConsoleDistPath(pathname);
    if (!relative) return false;
    if (CONSOLE_PUBLIC_FILES.has(relative)) return true;

    return CONSOLE_ASSET_PREFIXES.some((prefix) => {
        if (prefix.endsWith('/')) return relative.startsWith(prefix);
        return relative === prefix || relative.startsWith(`${prefix}/`);
    });
}
