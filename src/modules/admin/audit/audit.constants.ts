/**
 * Mirrors `enum AuditAction` in prisma/schema.prisma.
 * Prefer importing from `@/generated/prisma/client` after `prisma generate` when you need
 * the Prisma-typed enum; this local copy keeps DTOs/constants usable without a circular wait.
 */
export enum AuditAction {
    CREATE = 'CREATE',
    UPDATE = 'UPDATE',
    DELETE = 'DELETE',
    STATUS_CHANGE = 'STATUS_CHANGE',
    LOGIN = 'LOGIN',
    LOGOUT = 'LOGOUT',
    EXPORT = 'EXPORT',
    PURGE = 'PURGE',
    OTHER = 'OTHER',
}

export const AUDIT_RESOURCES = {
    AUTH: 'auth',
    USER: 'user',
    PROFILE: 'profile',
    RESUME: 'resume',
    JOB_POST: 'jobPost',
    APPLICATION: 'application',
    FILE: 'file',
    /** Backup and export both hand the user a copy of their whole account — the two actions
     *  most worth being able to reconstruct after the fact. */
    BACKUP: 'backup',
    DATA_EXPORT: 'dataExport',
    INTEGRATION: 'integration',
    CACHE: 'cache',
    AUDIT_LOG: 'auditLog',
    SYSTEM: 'system',
} as const;

/**
 * A known resource, or any other string.
 *
 * `(string & {})` rather than a bare `string`: a plain union with `string` collapses to
 * `string` and loses the autocomplete on the known values, which is the only reason the
 * constant exists. This keeps both — suggestions for the listed resources, and no error for
 * a module-specific one like `resume:section`.
 */
export type AuditResource = (typeof AUDIT_RESOURCES)[keyof typeof AUDIT_RESOURCES] | (string & {});
