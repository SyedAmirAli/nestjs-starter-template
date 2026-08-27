import { ApiError, apiFetch } from './api';
import { ADMIN_BASEPATH } from './paths';

/** The shape `GET /v1/auth/me` returns (src/auth/auth.service.ts, getCurrentUser). */
export interface CurrentUser {
    id: string;
    name: string;
    email: string;
    emailVerified: boolean;
    image: string | null;
    role: 'USER' | 'ADMIN';
    createdAt: string;
    /** True when the signed-in email is on the protected-users list (password reset / hard delete). */
    isSuperAdmin?: boolean;
}

/**
 * The signed-in user, or `null` if there is no session.
 *
 * Does not bounce to login on 401: the caller (route `beforeLoad`) decides whether that is
 * a redirect or a public page. Every other `apiFetch` still treats 401 as "go sign in".
 */
export async function fetchCurrentUser(signal?: AbortSignal): Promise<CurrentUser | null> {
    try {
        return await apiFetch<CurrentUser>('/auth/me', { signal, skipAuthRedirect: true });
    } catch (error: unknown) {
        if (error instanceof ApiError && error.status === 401) return null;
        throw error;
    }
}

export async function signIn(email: string, password: string): Promise<void> {
    const response = await fetch('/api/auth/sign-in/email', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ email, password, rememberMe: true }),
    });

    const body: { message?: string } = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(body.message || `Sign-in failed (${response.status})`);
    }
}

/** Ends the session and returns to the public login route. */
export async function signOut(): Promise<void> {
    await fetch('/api/auth/sign-out', { method: 'POST', credentials: 'same-origin' });
    window.location.assign(`${ADMIN_BASEPATH}/login`);
}
