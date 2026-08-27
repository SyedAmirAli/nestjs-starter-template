import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { WEB_DIST_DIR } from '@/config/dotenv';
import { serializeApiErrorBody } from '@/common/utils/serialize-api-error.util';
import { adminConsoleDistPath } from './console-path';

/**
 * Production: serve the built console out of `web/dist`, with SPA history fallback.
 *
 * `res.sendFile` does the heavy lifting — content types, ETags, conditional and range
 * requests — and, given a `root`, refuses to escape it. That containment is the security
 * property that matters here: the request path is attacker-controlled, and this handler is
 * the one place in the app that turns a URL into a filesystem read.
 */

const INDEX_FILE = 'index.html';

/**
 * Vite fingerprints everything it emits into `assets/`, so those URLs are content-addressed
 * and can be cached forever. Anything else in `dist/` was copied verbatim from `public/`
 * (favicon, robots.txt) and keeps its name across deploys, so it must revalidate or a
 * replaced file would be pinned in browser caches indefinitely.
 */
const IMMUTABLE_PREFIX = 'assets/';

/**
 * `private`, never `public` — including for the fingerprinted assets.
 *
 * The login route is public, so the bundle is reachable without a session. `private` still
 * stops a shared cache (a CDN, a corporate proxy) from pinning a response for a URL whose
 * body depends on the cookie — the shell especially, which the gate serves differently per
 * session. The browser can still cache normally, which is where the year-long lifetime
 * actually pays off.
 *
 * `Vary: Cookie` goes alongside for the same reason.
 */
const IMMUTABLE_CACHE = 'private, max-age=31536000, immutable';
const REVALIDATE_CACHE = 'private, no-cache';
const SHELL_CACHE = 'no-store, must-revalidate';

export function createStaticSpa(): RequestHandler {
    return (req: Request, res: Response, next: NextFunction): void => {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
            notFound(res, req.method);
            return;
        }

        // Vite's `base` is `/admin/`, so `/admin/assets/…` must read `dist/assets/…`.
        // A leading slash would be read as an absolute path and bypass `root`.
        const relative = adminConsoleDistPath(req.path);
        if (relative === '') {
            sendIndex(res, next);
            return;
        }

        // Set before `sendFile`, which only supplies its own Cache-Control when the response
        // does not already carry one. That is also how the shell's `no-store` survives below.
        res.setHeader('Cache-Control', relative.startsWith(IMMUTABLE_PREFIX) ? IMMUTABLE_CACHE : REVALIDATE_CACHE);
        res.setHeader('Vary', 'Cookie');

        res.sendFile(
            relative,
            { root: WEB_DIST_DIR, dotfiles: 'deny' },
            (error?: Error) => {
                if (!error) return;

                // The client went away, or the response is already committed — a second
                // attempt would throw ERR_HTTP_HEADERS_SENT on top of the original failure.
                if (res.headersSent) {
                    res.end();
                    return;
                }

                // Anything unreadable is treated as "not a file, so it must be a client-side
                // route". Distinguishing ENOENT from EACCES here would leak which paths exist
                // inside dist/, and the answer for the browser is identical either way.
                sendIndex(res, next);
            },
        );
    };
}

/**
 * The SPA shell, for `/admin` and for every client-side route (`/admin/system`) that has no
 * file behind it.
 *
 * Never cached: the admin gate serves this same URL differently per session, and a stale
 * shell also pins the old asset hashes after a deploy, which produces a console that loads
 * and then 404s on its own JavaScript.
 */
function sendIndex(res: Response, next: NextFunction): void {
    if (!existsSync(join(WEB_DIST_DIR, INDEX_FILE))) {
        notBuilt(res);
        return;
    }

    // Overwrites whatever the asset branch may have set on the way here.
    res.setHeader('Cache-Control', SHELL_CACHE);
    res.setHeader('Vary', 'Cookie');

    res.sendFile(INDEX_FILE, { root: WEB_DIST_DIR }, (error?: Error) => {
        if (!error) return;
        if (res.headersSent) {
            res.end();
            return;
        }
        next(error);
    });
}

function notFound(res: Response, method: string): void {
    res.status(404)
        .type('application/json')
        .send(
            JSON.stringify(
                serializeApiErrorBody({
                    message: `Cannot ${method} this path. The admin console only serves GET.`,
                    statusCode: 404,
                    code: 'WEB_NOT_FOUND',
                    status: 'normal',
                }),
            ),
        );
}

/**
 * The console is enabled but was never built. Distinguished from a 404 on purpose: a deploy
 * that ran `yarn build` without `yarn build:web` produces exactly this, and the fix is one
 * command that the message names.
 */
function notBuilt(res: Response): void {
    res.status(503).type('html').set('Cache-Control', 'no-store').send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Console not built</title>
<style>
  :root { color-scheme: dark; }
  body { margin:0; min-height:100vh; display:grid; place-items:center; background:#0a0a0b; color:#f4f4f5;
         font:15px/1.6 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; padding:24px; }
  main { max-width:520px; padding:32px; border:1px solid #26262b; border-radius:14px; background:#131316; }
  h1 { margin:0 0 8px; font-size:19px; font-weight:600; }
  p { margin:0 0 16px; color:#8b8b94; }
  code { display:block; padding:10px 12px; border-radius:8px; background:#0d0d10; border:1px solid #26262b;
         font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:13px; }
  small { display:block; margin-top:16px; color:#5c5c66; font-size:12px; word-break:break-all; }
</style></head>
<body><main>
  <h1>Admin console is not built</h1>
  <p>No <code>index.html</code> was found. Build the console, or set <code>WEB_ENABLED=false</code> to run the API alone.</p>
  <code>yarn build:web</code>
  <small>Looked in ${WEB_DIST_DIR.replace(/[<>&]/g, '')}</small>
</main></body></html>`);
}
