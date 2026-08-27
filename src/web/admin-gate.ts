import type { IncomingHttpHeaders } from 'node:http';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { fromNodeHeaders } from 'better-auth/node';
import { auth } from '@/auth/auth';
import { normalizeUserRole } from '@/auth/user-role';
import { serializeApiErrorBody } from '@/common/utils/serialize-api-error.util';
import { isReservedApiPath } from './reserved-paths';
import { ADMIN_LOGIN_PATH, isAdminConsolePath, isAdminLoginPath, isConsoleAssetPath } from './console-path';
import { renderForbiddenPage } from './login-page';

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
 * The console's entire request path: reserved-path bailout, console-prefix check, then
 * session gate, then serve.
 *
 * These are one middleware rather than chained ones, and that is deliberate. As separate
 * `app.use()` registrations, a reserved path would `next()` past the gate and land on the
 * serving middleware behind it — which has no notion of reserved paths and would happily
 * forward `/health` and `/v1/*` to the console. That failure is silent: the API keeps
 * answering, just with the console's HTML. Composing them here makes it unrepresentable —
 * `serve` is only ever reached by a request that has passed both checks.
 *
 * The console lives under `/admin`. `/admin/login` and the assets the SPA needs in order to
 * boot (the JS bundle, Vite's HMR client, stylesheets) are public, because the sign-in
 * screen is a route in the SPA. Every other `/admin` path still requires an ADMIN session:
 * anonymous callers are sent to `/admin/login` (HTML) or a JSON 401 (XHR), and a signed-in
 * non-admin gets the refusal page.
 *
 * @param serve Renders the console for a request that is allowed through — the dev proxy or
 *              the static handler, chosen by mount.ts.
 */
export function adminGate(serve: RequestHandler): RequestHandler {
    return (req: Request, res: Response, next: NextFunction): void => {
        if (isReservedApiPath(req.path) || !isAdminConsolePath(req.path)) {
            next();
            return;
        }

        const publicRoute = isAdminLoginPath(req.path) || isConsoleAssetPath(req.path);

        void resolveAdmin(req.headers)
            .then((admin) => {
                if (publicRoute) {
                    if (admin.ok) req.webAdmin = admin.user;
                    serve(req, res, next);
                    return;
                }

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
 * way to render a response — kept here so there is exactly one definition of what "admin"
 * means for the console. HMR upgrades no longer use this: login is public, so the websocket
 * that serves it must be too.
 */
export async function isAdminRequest(headers: IncomingHttpHeaders): Promise<boolean> {
    return (await resolveAdmin(headers)).ok;
}

function deny(req: Request, res: Response, result: Extract<GateResult, { ok: false }>): void {
    const status = result.reason === 'anonymous' ? 401 : 403;

    // The same URL yields the console, a redirect or a refusal depending purely on the
    // cookie. Any cache that missed that — a shared proxy, or the browser's own back/forward
    // cache — could hand one user's answer to another.
    res.setHeader('Cache-Control', 'no-store, must-revalidate');
    res.setHeader('Vary', 'Cookie');

    if (result.reason === 'anonymous' && wantsHtml(req)) {
        res.redirect(302, loginLocation(req));
        return;
    }

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

    if (result.reason === 'not-admin') {
        res.status(status).type('html').send(renderForbiddenPage(result.email));
        return;
    }
}

/**
 * Open-redirect-safe bounce to the SPA login, carrying the page the caller actually wanted
 * so a successful sign-in can return them there.
 */
function loginLocation(req: Request): string {
    const next = req.originalUrl.split('?')[0] ?? '';
    if (isAdminConsolePath(next) && !isAdminLoginPath(next)) {
        return `${ADMIN_LOGIN_PATH}?redirect=${encodeURIComponent(next)}`;
    }
    return ADMIN_LOGIN_PATH;
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
