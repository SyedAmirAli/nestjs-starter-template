import { ApiSuccessBody } from '@/common/responses/api-success.types';

export function serializeApiSuccessBody(body: ApiSuccessBody): Record<string, unknown> {
    return {
        message: body.message,
        localeKey: body.localeKey,
        status: body.status,
        data: body.data,
    };
}

export function isApiSuccessBody(value: unknown): value is ApiSuccessBody {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return false;
    }

    const record = value as Record<string, unknown>;

    return (
        typeof record.message === 'string' &&
        (record.localeKey === null || typeof record.localeKey === 'string') &&
        typeof record.status === 'string' &&
        'data' in record
    );
}
