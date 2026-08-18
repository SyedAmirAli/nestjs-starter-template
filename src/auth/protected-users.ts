/**
 * Protected system accounts, identified by email. This list has a **dual role**:
 *
 *  1. **As a target** — an account whose email is here can never be edited, activated,
 *     deactivated, deleted, or have its password changed, by anyone, through the User
 *     Management module. These are the untouchable system/owner accounts.
 *
 *  2. **As an actor** — only an admin *signed in with* one of these emails (a "super
 *     admin") may perform the dangerous actions: resetting another user's password and
 *     permanently (hard) deleting a user. A normal admin gets a 403.
 *
 * Enforcement lives in the backend (`UserService` guards) — the source of truth — since
 * server-side RBAC isn't wired yet and the frontend gate is advisory only.
 *
 * Fill in the real emails below. Matching is case-insensitive and trims whitespace.
 */
const RAW_PROTECTED_EMAILS: ReadonlyArray<string> = [
    // 'owner@glowquest.app',

    'amirralli300400@gmail.com',
];

export const PROTECTED_USER_EMAILS: ReadonlyArray<string> = RAW_PROTECTED_EMAILS.map((email) =>
    email.trim().toLowerCase(),
);

/** True when `email` belongs to a protected system account (case-insensitive). */
export const isProtectedEmail = (email?: string | null): boolean =>
    !!email && PROTECTED_USER_EMAILS.includes(email.trim().toLowerCase());
