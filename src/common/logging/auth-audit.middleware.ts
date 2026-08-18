import type { NextFunction, Request, Response } from 'express';
import type { AuditService } from '@/modules/admin/audit';
import { AuditAction, AUDIT_RESOURCES } from '@/modules/admin/audit/audit.constants';

/**
 * Which Better Auth endpoints to audit, and how to label them. Sign-in/up/out flow through
 * Better Auth's own mounted handler (not a Nest controller), so they never reach AuditService
 * on their own — this middleware records every attempt at the HTTP layer.
 */
const AUTH_EVENTS: Array<{ test: RegExp; action: AuditAction; label: string }> = [
    { test: /\/sign-in\/email$/, action: AuditAction.LOGIN, label: 'Email sign-in' },
    { test: /\/sign-in\/social$/, action: AuditAction.LOGIN, label: 'Social sign-in' },
    { test: /\/sign-in\/username$/, action: AuditAction.LOGIN, label: 'Username sign-in' },
    { test: /\/sign-up\/email$/, action: AuditAction.CREATE, label: 'Email sign-up' },
    { test: /\/sign-out$/, action: AuditAction.LOGOUT, label: 'Sign-out' },
];

const asString = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

/**
 * Express middleware that writes one audit-log row per sign-in / sign-up / sign-out request,
 * capturing pass, fail, and success alike. It reads the final HTTP status on `res.finish`
 * (success = 2xx/3xx, failure = ≥400) and, where present, the account email from the body.
 * Fire-and-forget via `logAsync` so it never delays or breaks the auth response.
 */
export function authAuditMiddleware(audit: AuditService) {
    return (req: Request, res: Response, next: NextFunction): void => {
        const path = (req.originalUrl || req.url).split('?')[0] ?? '';
        const event = path.includes('/api/auth/') ? AUTH_EVENTS.find((e) => e.test.test(path)) : undefined;
        if (!event) {
            next();
            return;
        }

        // Better Auth reads the raw stream itself and never sets req.body, so to learn WHICH
        // account an attempt targeted (valuable for failed logins) we passively buffer the body.
        // This middleware runs before Better Auth's handler; a passive 'data' listener observes
        // the chunks without pausing/consuming the stream, so the handler still reads it in full.
        let raw = '';
        req.on('data', (chunk: Buffer | string) => {
            if (raw.length < 16_384) raw += chunk.toString('utf8');
        });

        /** Pull email/provider from req.body if the stack set it, else from the buffered body. */
        const readCredentials = (): { email: string | null; provider: string | null } => {
            const body = (req.body as Record<string, unknown> | undefined) ?? {};
            let email = asString(body.email);
            let provider = asString(body.provider);
            if ((!email || !provider) && raw) {
                try {
                    const parsed = JSON.parse(raw) as Record<string, unknown>;
                    email = email ?? asString(parsed.email);
                    provider = provider ?? asString(parsed.provider);
                } catch {
                    // non-JSON body — keep whatever we already have
                }
            }
            return { email: email?.toLowerCase() ?? null, provider };
        };

        res.on('finish', () => {
            const statusCode = res.statusCode;
            const success = statusCode < 400;
            const { email, provider } = readCredentials();

            audit.logAsync({
                action: event.action,
                resource: AUDIT_RESOURCES.AUTH,
                actorEmail: email,
                summary: `${event.label} ${success ? 'succeeded' : 'failed'} (${statusCode})${email ? ` — ${email}` : ''}`,
                meta: {
                    event: event.label,
                    path,
                    method: req.method,
                    statusCode,
                    success,
                    provider: provider ?? undefined,
                    requestId: req.requestId,
                },
                ip: req.ip ?? asString(req.headers['x-forwarded-for']) ?? undefined,
                userAgent: asString(req.headers['user-agent']) ?? undefined,
            });
        });

        next();
    };
}
