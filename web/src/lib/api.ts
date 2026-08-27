/**
 * Client for the versioned API.
 *
 * There is no base URL to configure and no token to attach. The console is served by the API
 * process itself, so `/v1/...` is same-origin and the Better Auth session cookie rides along
 * on its own — which is exactly why the console is co-hosted rather than deployed separately.
 */

import { ADMIN_BASEPATH } from './paths';

/** Matches the server's global prefix. See src/main.ts and src/web/reserved-paths.ts. */
const API_PREFIX = '/v1';

/** The error envelope every failing endpoint returns (src/common/errors/api-error.types.ts). */
interface ApiErrorBody {
    message?: string;
    code?: string | null;
}

export class ApiError extends Error {
    readonly status: number;
    readonly code: string | null;

    constructor(message: string, status: number, code: string | null) {
        super(message);
        this.name = 'ApiError';
        this.status = status;
        this.code = code;
    }
}

/**
 * A 401 means the session died mid-visit — expired, revoked, or signed out in another tab.
 * Send the browser to the public login route rather than reloading the protected page, which
 * would only bounce through the server gate and land in the same place.
 *
 * Rate-limited because a 401 that survives the redirect (a bug, or an admin whose role was
 * revoked while the cookie stayed valid) would otherwise spin the browser indefinitely.
 */
const REDIRECT_COOLDOWN_MS = 10_000;
const REDIRECT_KEY = 'base-app:login-redirect-at';

function redirectToLogin(): void {
    const loginPath = `${ADMIN_BASEPATH}/login`;
    if (window.location.pathname === loginPath || window.location.pathname === `${loginPath}/`) return;

    const last = Number(sessionStorage.getItem(REDIRECT_KEY) ?? 0);
    if (Date.now() - last < REDIRECT_COOLDOWN_MS) return;

    sessionStorage.setItem(REDIRECT_KEY, String(Date.now()));

    const next = `${window.location.pathname}${window.location.search}`;
    const url =
        next.startsWith(ADMIN_BASEPATH) && next !== loginPath
            ? `${loginPath}?redirect=${encodeURIComponent(next)}`
            : loginPath;
    window.location.assign(url);
}

export type ApiFetchInit = RequestInit & {
    /** Skip the 401 → login redirect. Used by the session probe on public routes. */
    skipAuthRedirect?: boolean;
};

export async function apiFetch<T>(path: string, init?: ApiFetchInit): Promise<T> {
    const { skipAuthRedirect, ...fetchInit } = init ?? {};

    const response = await fetch(`${API_PREFIX}${path}`, {
        ...fetchInit,
        credentials: 'same-origin',
        headers: { accept: 'application/json', ...fetchInit.headers },
    });

    if (response.status === 401) {
        if (!skipAuthRedirect) redirectToLogin();
        throw new ApiError('Your session has expired.', 401, 'UNAUTHENTICATED');
    }

    // 204, and any response that simply has no body to read.
    const text = await response.text();
    const body: unknown = text ? JSON.parse(text) : null;

    if (!response.ok) {
        const { message, code } = (body ?? {}) as ApiErrorBody;
        throw new ApiError(message ?? `Request failed (${response.status})`, response.status, code ?? null);
    }

    return body as T;
}

/**
 * The liveness probe, which sits outside the version prefix so orchestrators need not track
 * API versions — hence the bare fetch rather than `apiFetch`.
 */
export async function fetchHealth(): Promise<{ status: string; name: string; env: string; at: string }> {
    const response = await fetch('/health', { headers: { accept: 'application/json' } });
    if (!response.ok) throw new ApiError(`Health check failed (${response.status})`, response.status, null);

    return response.json() as Promise<{ status: string; name: string; env: string; at: string }>;
}

export function isApiError(error: unknown): error is ApiError {
    return error instanceof ApiError;
}

/** Drop empty/undefined values so a filter that means "both" is simply omitted. */
export function toQuery(params: Record<string, unknown>): string {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
        if (value === undefined || value === null || value === '') continue;
        search.set(key, String(value));
    }
    const encoded = search.toString();
    return encoded ? `?${encoded}` : '';
}

/** Mutating endpoints wrap the payload in `{ message, localeKey, status, data }`. GET does not. */
export interface MutationEnvelope<T> {
    message: string;
    localeKey: string | null;
    status: string;
    data: T;
}

export async function apiMutate<T>(path: string, init?: ApiFetchInit): Promise<{ message: string; data: T }> {
    const body = await apiFetch<MutationEnvelope<T>>(path, {
        ...init,
        headers: { 'content-type': 'application/json', ...init?.headers },
    });
    return { message: body.message, data: body.data };
}
