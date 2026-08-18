import { HttpException } from '@nestjs/common';
import { ApiErrorBody, ApiErrorFieldMap, ErrorStatus } from '@/common/errors/api-error.types';

export class ApiException extends HttpException {
    constructor(payload: {
        statusCode: number;
        message: string;
        code?: string | null;
        localeKey?: string | null;
        status?: ErrorStatus | null;
        errors?: ApiErrorFieldMap | null;
        meta?: Record<string, unknown> | null;
    }) {
        const body: ApiErrorBody = {
            message: payload.message,
            statusCode: payload.statusCode,
        };

        if (payload.code !== undefined) {
            body.code = payload.code;
        }

        if (payload.localeKey !== undefined) {
            body.localeKey = payload.localeKey;
        }

        if (payload.status !== undefined) {
            body.status = payload.status;
        }

        if (payload.errors !== undefined) {
            body.errors = payload.errors;
        }

        if (payload.meta !== undefined) {
            body.meta = payload.meta;
        }

        super(body, payload.statusCode);
    }
}

export function isApiErrorBody(value: unknown): value is ApiErrorBody {
    if (!value || typeof value !== 'object') {
        return false;
    }

    const body = value as Partial<ApiErrorBody>;

    return typeof body.message === 'string' && typeof body.statusCode === 'number';
}
