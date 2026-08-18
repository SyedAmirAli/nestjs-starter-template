import { ApiErrorBody } from '@/common/errors/api-error.types';

export function serializeApiErrorBody(body: ApiErrorBody): Record<string, unknown> {
    const response: Record<string, unknown> = {
        message: body.message,
        statusCode: body.statusCode,
    };

    if (body.code !== undefined) {
        response.code = body.code;
    }

    if (body.localeKey !== undefined && body.localeKey !== null) {
        response.localeKey = body.localeKey;
    }

    if (body.status !== undefined) {
        response.status = body.status;
    }

    if (body.errors !== undefined) {
        response.errors = body.errors;
    }

    // Merged AFTER the standard envelope fields so a documented one-off contract field (e.g.
    // checkout's `conflicts`) can't accidentally shadow message/statusCode/code/etc.
    if (body.meta) {
        for (const [key, value] of Object.entries(body.meta)) {
            if (!(key in response)) response[key] = value;
        }
    }

    return response;
}
