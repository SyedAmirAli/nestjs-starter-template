import type { IncomingHttpHeaders } from 'node:http';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { fromNodeHeaders } from 'better-auth/node';
import { auth } from '@/auth/auth';
import { normalizeUserRole } from '@/auth/user-role';
import { serializeApiErrorBody } from '@/common/utils/serialize-api-error.util';
import { isReservedApiPath } from './reserved-paths';
import { renderForbiddenPage, renderSignInPage } from './login-page';

/** The admin identity attached to a request that cleared the gate. */
export interface WebAdmin {
    id: string;
    email: string;
    name: string;
}

declare module 'express-serve-static-core' {
    interface Request {
        /** Present only on requests the admin gate has already let through. */
        webAdmin?: WebAdmin;
    }
}

/**
 * The console's entire request path: reserved-path bailout, then session gate, then serve.
 *
 * These three are one middleware rather than three chained ones, and that is deliberate. As
 * separate `app.use()` registrations, a reserved path would `next()` past the gate and land
 * on the serving middleware behind it — which has no notion of reserved paths and would
 * happily forward `/health` and `/v1/*` to the console. That failure is silent: the API keeps
 * answering, just with the console's HTML. Composing them here makes it unrepresentable —
 * `serve` is only ever reached by a request that has passed both checks.
 *
 * On the gate itself: unlike the API — where the SPA would be handed to anyone and only its
 * data calls refused — nothing of the console reaches a caller without an ADMIN session, not
 * even the JavaScript bundle. An operator tool's client code is a map of the operator
 * surface: which endpoints exist, which fields they take, which flags gate which action.
 * Withholding it costs one round-trip on first load and removes that map from public reach.
 *
 * A rejected *navigation* gets an HTML page it can act on: sign-in when there is no session,
 * "not an admin" when there is one that does not qualify. A rejected *sub-resource* (an XHR,
 * a script, a stylesheet) gets the standard JSON error envelope instead — an HTML login page
 * returned as the body of a `fetch` produces the classic "Unexpected token '<'" and hides the
 * real cause, which is an expired session.
 *
 * @param serve Renders the console for an authorised request — the dev proxy or the static
 *              handler, chosen by mount.ts.
 */
export function adminGate(serve: RequestHandler): RequestHandler {
    return (req: Request, res: Response, next: NextFunction): void => {
        // The console is a catch-all on `/`, so this is the entire reason `/v1` and `/api`
        // still work. See reserved-paths.ts.
        if (isReservedApiPath(req.path)) {
            next();
            return;
        }

        void resolveAdmin(req.headers)
            .then((admin) => {
                if (!admin.ok) {
                    deny(req, res, admin);
                    return;
                }

                req.webAdmin = admin.user;
                serve(req, res, next);
            })
            .catch((error: unknown) => next(error));
    };
}

type GateResult =
    | { ok: true; user: WebAdmin }
    | { ok: false; reason: 'anonymous' }
    | { ok: false; reason: 'not-admin'; email: string };

/**
 * Resolves the caller's Better Auth session and checks it grants admin.
 *
 * `getSession` is the same call the API's guard makes, so a cookie minted by any client —
 * the console's own sign-in form, or a session already established elsewhere in the browser
 * — is honoured here without a second credential.
 *
 * `isActive` and `deletedAt` are deliberately not re-checked: the `session.create.before`
 * hook in auth.ts refuses to mint a session for a deactivated or soft-deleted account and
 * deactivation purges existing session rows, so an existing session already implies both.
 */
async function resolveAdmin(headers: IncomingHttpHeaders): Promise<GateResult> {
    const session = await auth.api.getSession({ headers: fromNodeHeaders(headers) });
    if (!session?.user) return { ok: false, reason: 'anonymous' };

    const { id, email, name, role } = session.user;
    if (normalizeUserRole(role) !== 'ADMIN') return { ok: false, reason: 'not-admin', email };

    return { ok: true, user: { id, email, name } };
}

/**
 * The same check, for callers that have raw headers rather than an Express request and no
 * way to render a response — the websocket upgrade path in dev-proxy.ts. Kept here so there
 * is exactly one definition of what "admin" means for the console.
 */
export async function isAdminRequest(headers: IncomingHttpHeaders): Promise<boolean> {
    return (await resolveAdmin(headers)).ok;
}

function deny(req: Request, res: Response, result: Extract<GateResult, { ok: false }>): void {
    const status = result.reason === 'anonymous' ? 401 : 403;

    // The same URL yields the console, a sign-in page or a refusal depending purely on the
    // cookie. Any cache that missed that — a shared proxy, or the browser's own back/forward
    // cache — could hand one user's answer to another.
    res.setHeader('Cache-Control', 'no-store, must-revalidate');
    res.setHeader('Vary', 'Cookie');

    if (!wantsHtml(req)) {
        res.status(status)
            .type('application/json')
            .send(
                JSON.stringify(
                    serializeApiErrorBody({
                        message:
                            result.reason === 'anonymous'
                                ? 'Sign in to use the admin console.'
                                : 'This account does not have admin access.',
                        statusCode: status,
                        code: result.reason === 'anonymous' ? 'WEB_UNAUTHENTICATED' : 'WEB_FORBIDDEN',
                        status: 'warn',
                    }),
                ),
            );
        return;
    }

    const html = result.reason === 'anonymous' ? renderSignInPage() : renderForbiddenPage(result.email);
    res.status(status).type('html').send(html);
}

/**
 * Whether this request is a browser navigating, as opposed to fetching a sub-resource.
 *
 * `Sec-Fetch-Mode: navigate` is the reliable signal and every current browser sends it. The
 * Accept sniff is the fallback for anything that does not (curl, older clients); `*\/*` is
 * excluded from it because that is what `fetch()` defaults to.
 */
function wantsHtml(req: Request): boolean {
    if (req.method !== 'GET' && req.method !== 'HEAD') return false;
    if (req.headers['sec-fetch-mode'] === 'navigate') return true;

    return (req.headers.accept ?? '').split(',').some((type) => type.trim().startsWith('text/html'));
}
