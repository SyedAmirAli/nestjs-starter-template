import { ErrorStatus } from '@/common/errors/api-error.types';
import {
    ApiSuccessBody,
    ApiSuccessMetaOptions,
    DEFAULT_SUCCESS_MESSAGE,
    DEFAULT_SUCCESS_STATUS,
} from '@/common/responses/api-success.types';

const SUCCESS_STATUSES = new Set<ErrorStatus>(['critical', 'normal', 'warn']);

function resolveLocaleKey(value: unknown): string | null | undefined {
    if (value === null || typeof value === 'string') {
        return value;
    }

    return undefined;
}

function extractPartialSuccessPayload(data: unknown): {
    message?: string;
    localeKey?: string | null;
    status?: ErrorStatus;
    data: unknown;
} | null {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
        return null;
    }

    const record = data as Record<string, unknown>;

    if (!('data' in record)) {
        return null;
    }

    const partial: {
        message?: string;
        localeKey?: string | null;
        status?: ErrorStatus;
        data: unknown;
    } = {
        data: record.data,
    };

    if (typeof record.message === 'string') {
        partial.message = record.message;
    }

    const localeKey = resolveLocaleKey(record.localeKey);
    if (localeKey !== undefined) {
        partial.localeKey = localeKey;
    }

    if (typeof record.status === 'string' && SUCCESS_STATUSES.has(record.status as ErrorStatus)) {
        partial.status = record.status as ErrorStatus;
    }

    return partial;
}

export function mapPayloadToApiSuccess(data: unknown, meta?: ApiSuccessMetaOptions): ApiSuccessBody {
    const defaults = {
        message: meta?.message ?? DEFAULT_SUCCESS_MESSAGE,
        localeKey: meta?.localeKey ?? null,
        status: meta?.status ?? DEFAULT_SUCCESS_STATUS,
    };

    const partial = extractPartialSuccessPayload(data);

    if (partial) {
        return {
            message: partial.message ?? defaults.message,
            localeKey: partial.localeKey !== undefined ? partial.localeKey : defaults.localeKey,
            status: partial.status ?? defaults.status,
            data: partial.data ?? null,
        };
    }

    return {
        message: defaults.message,
        localeKey: defaults.localeKey,
        status: defaults.status,
        data: data ?? null,
    };
}
