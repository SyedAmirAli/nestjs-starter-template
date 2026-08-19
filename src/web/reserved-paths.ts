/**
 * The top-level path namespaces the API owns, and which the web console must never claim.
 *
 * The web console is mounted at `/` and is therefore a catch-all: every path the API does
 * not answer becomes an admin-panel route. That is only safe while the two sets are
 * provably disjoint, so the boundary lives here, in one list, rather than being re-derived
 * by each middleware that needs it.
 *
 * `/api` alone is not sufficient. The API surface is split across four namespaces:
 *
 *   /v1        every Nest controller (main.ts, setGlobalPrefix)
 *   /api       Better Auth's own mounted router (app.module.ts, AuthModule.forRoot)
 *   /health    the liveness probe, deliberately kept outside the version prefix
 *   /docs      Swagger UI and its JSON/YAML spec siblings
 *
 * ADDING A NEW TOP-LEVEL API PATH: put it under `/v1` and nothing here needs to change.
 * If it genuinely cannot live under `/v1` — a webhook receiver a third party dictates the
 * URL of, say — add it below in the same commit that registers it. A route added to the
 * server but not to this list is unreachable: the web catch-all answers it first.
 */
export const RESERVED_API_PREFIXES = ['/v1', '/api', '/health', '/docs', '/docs-json', '/docs-yaml'] as const;

/**
 * Whether a request path belongs to the API rather than the web console.
 *
 * Matches a prefix either exactly (`/health`) or as a path segment boundary (`/v1/auth/me`).
 * The boundary check is what stops `/v1analytics` — a plausible future console route — from
 * being swallowed as API traffic.
 *
 * Pass `req.path`, or strip the query string first: a raw `req.url` of `/?next=/v1` would
 * otherwise be judged on its query rather than its path.
 */
export function isReservedApiPath(pathname: string): boolean {
    // Express gives paths without a query but keeps the trailing slash; `/v1/` and `/v1`
    // reach the same router, so they must classify the same way.
    const path = pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;

    return RESERVED_API_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}
