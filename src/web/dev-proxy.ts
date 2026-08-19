import type { IncomingMessage, Server } from 'node:http';
import type { Socket } from 'node:net';
import type { RequestHandler } from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { WEB_DEV_SERVER_URL } from '@/config/dotenv';
import { isReservedApiPath } from './reserved-paths';

/**
 * Development: reverse-proxy `/` to the Vite dev server.
 *
 * Proxying rather than embedding Vite in middleware mode keeps the two processes
 * independent — the API can restart on a `nest start --watch` recompile without tearing down
 * HMR state, and `yarn dev:web` alone still works for pure frontend work. The cost is that
 * the console is only reachable through the API's origin, which is the point: same origin
 * means the session cookie the admin gate reads is the same one the API already issues.
 *
 * Production never loads this file — see mount.ts.
 */

/** Where the browser is told to look when the dev server is not answering. */
const START_HINT = 'yarn dev:web';

export interface DevProxy {
    middleware: RequestHandler;
    /** Attach to the http server's `upgrade` event so Vite's HMR websocket survives. */
    attachUpgrade: (server: Server, authorize: UpgradeAuthorizer) => void;
}

/**
 * Decides whether a websocket upgrade may reach Vite. Resolves false to drop the socket.
 * The gate applies to HMR exactly as it does to page loads — a rejected upgrade has no way
 * to render a sign-in page, so the only honest answer is to refuse the handshake.
 */
export type UpgradeAuthorizer = (req: IncomingMessage) => Promise<boolean>;

export function createDevProxy(): DevProxy {
    const proxy = createProxyMiddleware({
        target: WEB_DEV_SERVER_URL,
        // The dev server is addressed as localhost while the browser addressed us as
        // whatever the API is bound to. Vite's `server.host` checks compare against the Host
        // header, so it has to be rewritten to the target's.
        changeOrigin: true,
        // `ws` is deliberately NOT set. It would make the proxy subscribe to the server's
        // `upgrade` event itself on the first proxied request, which bypasses the admin gate
        // — HMR would then be reachable without a session. attachUpgrade() below does the
        // subscription, gated.
        ws: false,
        // No `logger`: failures are reported by `on.error` below, in a form that tells the
        // developer what to do about it rather than dumping a stack trace.
        on: {
            error: (error, _req, res) => {
                if (!('writeHead' in res)) {
                    res.destroy();
                    return;
                }
                if (res.headersSent) {
                    res.end();
                    return;
                }

                res.writeHead(502, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
                res.end(unreachablePage(error));
            },
        },
    });

    return {
        middleware: proxy,
        attachUpgrade: (server, authorize) => {
            server.on('upgrade', (req: IncomingMessage, socket: Socket, head: Buffer) => {
                // Nest and Better Auth do not handle upgrades, but a future websocket API
                // would — and it would live under a reserved prefix. Leave those alone
                // rather than swallowing every upgrade on the server.
                if (isReservedApiPath(pathOf(req))) return;

                void authorize(req)
                    .then((allowed) => {
                        if (!allowed) {
                            socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
                            socket.destroy();
                            return;
                        }
                        proxy.upgrade(req, socket, head);
                    })
                    .catch(() => socket.destroy());
            });
        },
    };
}

function pathOf(req: IncomingMessage): string {
    return (req.url ?? '/').split('?')[0] ?? '/';
}

/**
 * Shown when the Vite dev server is not up. A bare ECONNREFUSED here reads as "the backend
 * is broken", when in fact the backend is fine and one of the two dev processes is missing —
 * so the page names the process and the command that starts it.
 */
function unreachablePage(error: Error): string {
    const detail = `${error.message} (${WEB_DEV_SERVER_URL})`.replace(/[<>&]/g, '');

    return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Dev server unreachable</title>
<style>
  :root { color-scheme: dark; }
  body { margin:0; min-height:100vh; display:grid; place-items:center; background:#0a0a0b; color:#f4f4f5;
         font:15px/1.6 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; padding:24px; }
  main { max-width:520px; padding:32px; border:1px solid #26262b; border-radius:14px; background:#131316; }
  h1 { margin:0 0 8px; font-size:19px; font-weight:600; }
  p { margin:0 0 16px; color:#8b8b94; }
  code { display:block; padding:10px 12px; border-radius:8px; background:#0d0d10; border:1px solid #26262b;
         color:#f4f4f5; font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:13px; }
  small { display:block; margin-top:16px; color:#5c5c66; font-size:12px; }
</style></head>
<body><main>
  <h1>Vite dev server is not running</h1>
  <p>The API is up and proxying <code>/</code> to the console&rsquo;s dev server, but nothing is listening there.</p>
  <code>${START_HINT}</code>
  <small>${detail}</small>
</main>
<script>setTimeout(function(){ window.location.reload(); }, 3000);</script>
</body></html>`;
}
