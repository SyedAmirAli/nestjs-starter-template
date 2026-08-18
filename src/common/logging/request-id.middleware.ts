import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

export const REQUEST_ID_HEADER = 'x-request-id';

/** Max length we will echo back. An unbounded client-supplied id is a log-injection vector
 *  and a way to blow up log storage; 128 chars comfortably fits a UUID or a ULID. */
const MAX_INBOUND_LENGTH = 128;

/** Printable ASCII only. A header carrying a newline could forge a second log line. */
const SAFE_ID = /^[A-Za-z0-9._:-]+$/;

declare module 'express-serve-static-core' {
    interface Request {
        /** Correlation id for this request. Always set — see requestIdMiddleware. */
        requestId?: string;
    }
}

/**
 * Assigns every request a correlation id, echoed on the response as `x-request-id`.
 *
 * The id is what ties an error the user reports ("it said request 01JC8…") to the log lines
 * and the audit rows for that request. It is generated here rather than in the logger so
 * that everything downstream — the error envelope, the audit middleware, the access log —
 * sees the same value.
 *
 * An inbound `x-request-id` is honoured so a trace started at the proxy or in the mobile
 * client survives into our logs, but only after validation: the value is echoed into a
 * response header and into log output, so an unvalidated one would let a caller inject
 * whatever it liked into both.
 */
export function requestIdMiddleware() {
    return (req: Request, res: Response, next: NextFunction): void => {
        const inbound = req.headers[REQUEST_ID_HEADER];
        const candidate = Array.isArray(inbound) ? inbound[0] : inbound;

        const requestId =
            candidate && candidate.length <= MAX_INBOUND_LENGTH && SAFE_ID.test(candidate) ? candidate : randomUUID();

        req.requestId = requestId;
        res.setHeader(REQUEST_ID_HEADER, requestId);

        next();
    };
}
