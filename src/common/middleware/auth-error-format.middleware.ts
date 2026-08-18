import { NextFunction, Request, Response } from 'express';
import { mapPayloadToApiError } from '@/common/utils/map-api-error.util';
import { serializeApiErrorBody } from '@/common/utils/serialize-api-error.util';

function toBuffer(chunk: unknown): Buffer {
    if (Buffer.isBuffer(chunk)) {
        return chunk;
    }

    if (chunk instanceof Uint8Array) {
        return Buffer.from(chunk);
    }

    return Buffer.from(String(chunk));
}

function normalizeErrorPayload(payload: unknown, statusCode: number, method: string) {
    return serializeApiErrorBody(mapPayloadToApiError(payload, statusCode, method));
}

export function patchResponseForApiErrors(res: Response, method: string): void {
    if ((res as Response & { __apiErrorPatched?: boolean }).__apiErrorPatched) {
        return;
    }

    (res as Response & { __apiErrorPatched?: boolean }).__apiErrorPatched = true;

    const buffer: Buffer[] = [];

    const shouldBuffer = () => res.statusCode >= 400;

    const originalWriteHead = res.writeHead.bind(res);

    res.writeHead = ((statusCode: number, ...args: any[]) => {
        return originalWriteHead(statusCode, ...args);
    }) as typeof res.writeHead;

    const originalWrite = res.write.bind(res);
    res.write = function write(chunk: unknown, ...args: unknown[]) {
        if (shouldBuffer() && chunk) {
            buffer.push(toBuffer(chunk));
            const callback = typeof args[args.length - 1] === 'function' ? (args.pop() as () => void) : undefined;
            callback?.();
            return true;
        }

        return originalWrite(chunk, ...(args as []));
    };

    const originalEnd = res.end.bind(res);
    res.end = function end(chunk?: unknown, ...args: unknown[]) {
        const statusCode = res.statusCode;

        if (statusCode >= 400) {
            if (chunk) {
                buffer.push(toBuffer(chunk));
            }

            const raw = Buffer.concat(buffer).toString('utf8');
            let parsed: unknown = {};

            try {
                parsed = raw ? (JSON.parse(raw) as unknown) : {};
            } catch {
                return originalEnd(raw);
            }

            const normalized = JSON.stringify(normalizeErrorPayload(parsed, statusCode, method));

            // Headers are already sent by writeHead before the body is streamed.
            return originalEnd(normalized);
        }

        return originalEnd(chunk, ...(args as []));
    };

    if (typeof res.json === 'function') {
        const originalJson = res.json.bind(res);
        res.json = function json(body: unknown) {
            if (res.statusCode >= 400) {
                return originalJson(normalizeErrorPayload(body, res.statusCode, method));
            }

            return originalJson(body);
        };
    }
}

export function authErrorFormatMiddleware(req: Request, res: Response, next: NextFunction): void {
    patchResponseForApiErrors(res, req.method);
    next();
}
