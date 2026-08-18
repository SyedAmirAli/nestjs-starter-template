export const USER_ROLES = ['USER', 'ADMIN'] as const;

export type UserRole = (typeof USER_ROLES)[number];

export const DEFAULT_USER_ROLE: UserRole = 'USER';

/**
 * Roles allowed on admin-only routes. Pass to the Better Auth `@Roles()` decorator on every
 * admin controller — the global AuthGuard reads `session.user.role`, returning 401 when
 * unauthenticated and 403 when the role does not match.
 */
export const ADMIN_ROLES: Array<string> = ['ADMIN'];

/** Anything that is not exactly 'ADMIN' is a plain user. Deny-by-default on a bad value. */
export function normalizeUserRole(role: unknown): UserRole {
    return role === 'ADMIN' ? 'ADMIN' : DEFAULT_USER_ROLE;
}
