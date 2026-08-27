/** Must match Vite `base` and the server's `ADMIN_CONSOLE_BASE` (src/web/console-path.ts). */
export const ADMIN_BASEPATH = '/admin'

export type DashboardPath = '/' | '/system' | '/users' | '/account-delete' | '/audit' | '/caches'

const DASHBOARD_PATHS: ReadonlyArray<DashboardPath> = ['/', '/system', '/users', '/account-delete', '/audit', '/caches']

/**
 * Map a `?redirect=` value onto a real dashboard route.
 *
 * Anything we do not recognise becomes `/` — that is both an open-redirect guard and how
 * a stale bookmark after a rename still lands somewhere useful.
 */
export function dashboardPathFromRedirect(redirect: string | undefined): DashboardPath {
    if (!redirect) return '/'

    let path = redirect.split('?')[0] ?? '/'
    if (path.startsWith(ADMIN_BASEPATH)) {
        path = path.slice(ADMIN_BASEPATH.length) || '/'
    }

    const normalized = (path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path) as DashboardPath
    if ((DASHBOARD_PATHS as readonly string[]).includes(normalized)) return normalized
    return '/'
}
