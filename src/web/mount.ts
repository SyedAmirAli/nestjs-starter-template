import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DEVELOPMENT, WEB_DEV_SERVER_URL, WEB_DIST_DIR, WEB_ENABLED } from '@/config/dotenv';
import { adminGate, isAdminRequest } from './admin-gate';
import { createStaticSpa } from './static-spa';

export interface WebConsoleInfo {
    /** `proxy` forwards to the Vite dev server; `static` serves the built bundle. */
    mode: 'proxy' | 'static';
    /** Where the content comes from — a dev server URL or a directory. */
    source: string;
}

/**
 * Mounts the admin web console on `/`.
 *
 * Call after the Nest app exists and before it listens. Everything registered here is
 * Express-level middleware, which runs ahead of the Nest router, so the console would
 * shadow the entire API if it did not exclude the reserved prefixes first — the gate does
 * that check before anything else (see reserved-paths.ts).
 *
 * Ordering against the rest of the stack falls out of when this runs. Nest invokes every
 * module's `configure()` during `NestFactory.create`, so request-id, the access log and
 * Better Auth have all claimed their position by the time main.ts gets here — meaning
 * console requests are correlated and logged exactly like API requests, which is what you
 * want the first time an operator reports a page that will not load.
 *
 * Returns null when the console is switched off, so the caller can leave it out of the
 * startup banner rather than advertising a route that 404s.
 */
export function mountWebConsole(app: NestExpressApplication): WebConsoleInfo | null {
    if (!WEB_ENABLED) return null;

    if (!DEVELOPMENT) {
        warnIfNotBuilt();
        // One registration, not two: the gate takes the serving handler as an argument so a
        // reserved path can never reach it. See admin-gate.ts.
        app.use(adminGate(createStaticSpa()));
        return { mode: 'static', source: WEB_DIST_DIR };
    }

    // Required lazily. http-proxy-middleware is a development-only concern, and a production
    // image installed with --production has no reason to load it — or to have it installed.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createDevProxy } = require('./dev-proxy') as typeof import('./dev-proxy');

    const proxy = createDevProxy();
    proxy.attachUpgrade(app.getHttpServer(), (req) => isAdminRequest(req.headers));
    app.use(adminGate(proxy.middleware));

    return { mode: 'proxy', source: WEB_DEV_SERVER_URL };
}

/**
 * A deploy that ran `yarn build` but not `yarn build:web` boots perfectly and then serves a
 * 503 to the first operator who opens the console. Say so at boot instead — but do not throw:
 * the API is entirely functional without the console, and taking it down over an operator
 * tool would turn a cosmetic mistake into an outage.
 */
function warnIfNotBuilt(): void {
    if (existsSync(join(WEB_DIST_DIR, 'index.html'))) return;

    console.warn(
        `[web] Admin console is enabled but not built — no index.html in ${WEB_DIST_DIR}. ` +
            'Run `yarn build:web`, or set WEB_ENABLED=false. The API is unaffected.',
    );
}
