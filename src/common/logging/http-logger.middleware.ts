import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

/**
 * Morgan-style access logger. One line per completed request:
 *
 *   [Tuesday, 23 April 2025 - 11:55:59PM] POST /v1/resumes 201 142.3ms - 1.2kb  01JC8…
 *
 * Mounted at the Express level (see LoggingModule) rather than through Nest's
 * MiddlewareConsumer, so handlers registered outside Nest controllers — Better Auth's
 * mounted router at /api/auth in particular — are included. A logger that silently omits
 * every auth request is worse than no logger, because it looks complete.
 *
 * Toggle off entirely with HTTP_LOG=false.
 */

// Colors are only emitted to an interactive terminal. In production stdout is usually a
// pipe or a file (process manager, container, log aggregator), where ANSI codes are noise
// that also defeats grep — so they collapse to empty strings, which additionally trims a
// little per-line string work.
const COLOR = !!process.stdout.isTTY && process.env.NO_COLOR !== '1';
const wrap = (code: string) => (COLOR ? code : '');
const c = {
    reset: wrap('\x1b[0m'),
    dim: wrap('\x1b[2m'),
    bold: wrap('\x1b[1m'),
    gray: wrap('\x1b[90m'),
    green: wrap('\x1b[32m'),
    cyan: wrap('\x1b[36m'),
    yellow: wrap('\x1b[33m'),
    red: wrap('\x1b[31m'),
    magenta: wrap('\x1b[35m'),
};

const ENABLED = process.env.HTTP_LOG !== 'false';

/** Favicon and k8s/docker health probes are high-frequency, zero-signal noise. */
const SKIP = /^\/(favicon\.ico|health)\b/;

const DATE_FMT = new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
});
const TIME_FMT = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
});

/**
 * Formatted timestamp, memoised to one-second granularity.
 *
 * Two `Intl.DateTimeFormat.format()` calls plus a regex replace per request is real work at
 * a few thousand requests a second, and every request inside the same second produces a
 * byte-identical string — so it is computed once and reused. This is the one piece of
 * caching in the logger, and it is safe precisely because the output has second resolution.
 */
let cachedSecond = -1;
let cachedTimestamp = '';

function formatTimestamp(now: number): string {
    const second = Math.floor(now / 1000);
    if (second === cachedSecond) return cachedTimestamp;

    const date = new Date(now);
    cachedSecond = second;
    cachedTimestamp = `${DATE_FMT.format(date)} - ${TIME_FMT.format(date).replace(/\s/g, '')}`;
    return cachedTimestamp;
}

function methodColor(method: string): string {
    switch (method) {
        case 'GET':
            return c.cyan;
        case 'POST':
            return c.green;
        case 'PUT':
        case 'PATCH':
            return c.yellow;
        case 'DELETE':
            return c.red;
        default:
            return c.magenta;
    }
}

function statusColor(status: number): string {
    if (status >= 500) return c.red;
    if (status >= 400) return c.yellow;
    if (status >= 300) return c.cyan;
    if (status >= 200) return c.green;
    return c.gray;
}

function formatBytes(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0b';
    if (bytes < 1024) return `${bytes}b`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}kb`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}mb`;
}

/**
 * `content-length` is typed `number | string | string[]` by Node. The array form only
 * arises from a duplicated header, where `Number(['1','2'])` is NaN — which would silently
 * render as "0b" and quietly understate every such response. Take the first value instead.
 */
function responseBytes(res: Response): string {
    const raw = res.getHeader('content-length');
    if (raw === undefined) return '';

    const value = Number(Array.isArray(raw) ? raw[0] : raw);
    if (!Number.isFinite(value)) return '';

    return ` ${c.dim}- ${formatBytes(value)}${c.reset}`;
}

export function httpLogger() {
    return (req: Request, res: Response, next: NextFunction): void => {
        if (!ENABLED || SKIP.test(req.originalUrl)) {
            next();
            return;
        }

        const start = process.hrtime.bigint();
        const { method, originalUrl } = req;

        // Both events are needed, and exactly one must win.
        //
        // 'finish' fires when the response has been handed to the OS — the normal case.
        // 'close'  fires when the socket goes away, which for an aborted request (the user
        //          backgrounds the app mid-upload, the network drops) is the ONLY event that
        //          fires. Listening on 'finish' alone — as the original did — means every
        //          abandoned request vanishes from the log, and abandoned uploads are exactly
        //          the requests worth seeing.
        //
        // On a healthy response both fire, hence the guard: `res.writableFinished` is false
        // only when the response never completed.
        let logged = false;
        const emit = (aborted: boolean) => {
            if (logged) return;
            logged = true;

            const durationMs = Number(process.hrtime.bigint() - start) / 1_000_000;
            const status = res.statusCode;
            const requestId = req.requestId ? ` ${c.dim}${req.requestId}${c.reset}` : '';
            const abortedTag = aborted ? ` ${c.yellow}(aborted)${c.reset}` : '';

            console.log(
                `${c.gray}[${formatTimestamp(Date.now())}]${c.reset} ` +
                    `${c.bold}${methodColor(method)}${method}${c.reset} ` +
                    `${originalUrl} ` +
                    `${statusColor(status)}${status}${c.reset} ` +
                    `${c.dim}${durationMs.toFixed(1)}ms${c.reset}` +
                    responseBytes(res) +
                    abortedTag +
                    requestId,
            );
        };

        res.on('finish', () => emit(false));
        res.on('close', () => emit(!res.writableFinished));

        next();
    };
}

/** @deprecated Use LoggingModule — Nest's MiddlewareConsumer misses Express-only routes. */
@Injectable()
export class HttpLoggerMiddleware implements NestMiddleware {
    private readonly handler = httpLogger();

    use(req: Request, res: Response, next: NextFunction): void {
        this.handler(req, res, next);
    }
}
