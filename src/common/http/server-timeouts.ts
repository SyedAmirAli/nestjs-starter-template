/**
 * Applies Node HTTP server timeouts.
 *
 * ─── Why this mutates http.Server directly ───────────────────────────────────
 * NestJS has no abstraction over `requestTimeout`, `headersTimeout` or
 * `keepAliveTimeout`. They are properties of Node's `http.Server`, read per request by
 * the HTTP parser itself — not middleware, not interceptors, and not part of any
 * platform adapter's options. `NestFactory.create()` accepts no equivalent setting, and
 * an interceptor cannot help: by the time one runs, the parser has already been
 * governing the socket for the entire upload.
 *
 * So mutation is the only correct mechanism, and `app.getHttpServer()` is the public,
 * documented way to reach the server. What was wrong before was not the mutation but
 * that it sat inline in `main.ts` as four bare numbers with no validation and no name.
 * Here it is one named function with validated configuration and a stated rationale.
 *
 * Platform note: this reads the server through the Express adapter's `http.Server`. On
 * a Fastify adapter `getHttpServer()` returns the same Node server, so the assignment
 * remains valid; only the surrounding bootstrap would differ.
 */

import type { Server } from 'node:http';
import { readIntEnv } from '@/config/env';

const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;

/** Bounds catch a unit mix-up (seconds passed where milliseconds are expected). */
const TIMEOUT_RANGE = { min: 1 * SECOND_MS, max: 60 * MINUTE_MS };

/**
 * How long one complete request (headers + body) may take.
 *
 * Node's default is 5 minutes. nginx buffers the request body before proxying
 * (`proxy_request_buffering` is on by default), so the slow-mobile leg is bounded by
 * nginx's `client_body_timeout` rather than by this — but a large multipart upload
 * arriving over a slow upstream link must not trip it, or a fixed 413 simply becomes
 * a 504.
 */
export const REQUEST_TIMEOUT_MS = readIntEnv('HTTP_REQUEST_TIMEOUT_MS', 15 * MINUTE_MS, TIMEOUT_RANGE);

/** How long the client may take to send complete headers. Node's default is 60s. */
export const HEADERS_TIMEOUT_MS = readIntEnv('HTTP_HEADERS_TIMEOUT_MS', 2 * MINUTE_MS, TIMEOUT_RANGE);

/**
 * Idle keep-alive window. Must exceed the proxy's own upstream keep-alive so nginx
 * never reuses a socket Node has just closed (which surfaces to clients as a sporadic
 * 502 under load).
 */
export const KEEP_ALIVE_TIMEOUT_MS = readIntEnv('HTTP_KEEP_ALIVE_TIMEOUT_MS', 65 * SECOND_MS, TIMEOUT_RANGE);

export interface ServerTimeouts {
    requestTimeout: number;
    headersTimeout: number;
    keepAliveTimeout: number;
}

/** The timeouts that will be applied. Exposed for the startup banner and for tests. */
export function resolveServerTimeouts(): ServerTimeouts {
    return {
        requestTimeout: REQUEST_TIMEOUT_MS,
        headersTimeout: HEADERS_TIMEOUT_MS,
        keepAliveTimeout: KEEP_ALIVE_TIMEOUT_MS,
    };
}

/**
 * Applies the resolved timeouts to a Node HTTP server.
 *
 * `headersTimeout` must stay above `keepAliveTimeout`; otherwise Node can time out
 * headers on a connection it was still willing to keep alive.
 */
export function applyServerTimeouts(server: Server, timeouts: ServerTimeouts = resolveServerTimeouts()): void {
    server.requestTimeout = timeouts.requestTimeout;
    server.headersTimeout = Math.max(timeouts.headersTimeout, timeouts.keepAliveTimeout + SECOND_MS);
    server.keepAliveTimeout = timeouts.keepAliveTimeout;
}
