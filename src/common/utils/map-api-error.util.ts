/* eslint-disable @typescript-eslint/no-unsafe-enum-comparison -- statusCode arrives as a
   plain number off the wire and is compared against HttpStatus members by value. */
import { HttpStatus } from '@nestjs/common';
import { ApiErrorBody, ErrorStatus, MUTATING_HTTP_METHODS } from '@/common/errors/api-error.types';
import { isDuplicateUserError } from '@/common/utils/api-error-status.util';

const DEFAULT_STATUS_CODES: Record<number, { code: string; status: ErrorStatus }> = {
    [HttpStatus.BAD_REQUEST]: {
        code: 'BAD_REQUEST',
        status: 'warn',
    },
    [HttpStatus.UNAUTHORIZED]: {
        code: 'UNAUTHORIZED',
        status: 'normal',
    },
    [HttpStatus.FORBIDDEN]: {
        code: 'FORBIDDEN',
        status: 'normal',
    },
    [HttpStatus.NOT_FOUND]: {
        code: 'NOT_FOUND',
        status: 'normal',
    },
    [HttpStatus.CONFLICT]: {
        code: 'USER_ALREADY_EXISTS',
        status: 'warn',
    },
    [HttpStatus.UNPROCESSABLE_ENTITY]: {
        code: 'VALIDATION_ERROR',
        status: 'warn',
    },
    [HttpStatus.INTERNAL_SERVER_ERROR]: {
        code: 'INTERNAL_SERVER_ERROR',
        status: 'critical',
    },
};

function resolveDefaultStatus(statusCode: number): ErrorStatus | null {
    if (statusCode >= 500) {
        return 'critical';
    }

    if (statusCode === HttpStatus.BAD_REQUEST || statusCode === HttpStatus.UNPROCESSABLE_ENTITY) {
        return 'warn';
    }

    if (statusCode >= 400) {
        return 'normal';
    }

    return null;
}

export function resolveApiErrorDefaults(statusCode: number) {
    return (
        DEFAULT_STATUS_CODES[statusCode] ?? {
            code: 'HTTP_ERROR',
            status: resolveDefaultStatus(statusCode),
        }
    );
}

const DUPLICATE_USER_MESSAGE = 'An account with this email already exists.';

export function mapPayloadToApiError(payload: unknown, statusCode: number, method: string): ApiErrorBody {
    const defaults = resolveApiErrorDefaults(statusCode);
    const record =
        payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : ({} as Record<string, unknown>);

    const rawCode = typeof record.code === 'string' ? record.code : null;
    const duplicateUser = isDuplicateUserError(rawCode);
    const resolvedStatusCode = duplicateUser ? HttpStatus.CONFLICT : statusCode;
    const resolvedDefaults = resolveApiErrorDefaults(resolvedStatusCode);

    const message =
        (duplicateUser ? DUPLICATE_USER_MESSAGE : undefined) ??
        (typeof record.message === 'string' ? record.message : undefined) ??
        'Request failed';

    const code = duplicateUser ? 'USER_ALREADY_EXISTS' : (rawCode ?? defaults.code);
    const status =
        (typeof record.status === 'string' ? (record.status as ErrorStatus) : null) ?? resolvedDefaults.status;

    const fieldErrors =
        record.errors && typeof record.errors === 'object' && !Array.isArray(record.errors)
            ? (record.errors as Record<string, string[]>)
            : null;

    const errors =
        MUTATING_HTTP_METHODS.has(method.toUpperCase()) && fieldErrors && Object.keys(fieldErrors).length
            ? fieldErrors
            : null;

    const body: ApiErrorBody = {
        message,
        statusCode: resolvedStatusCode,
        code,
        status,
        errors,
    };

    if (typeof record.localeKey === 'string') {
        body.localeKey = record.localeKey;
    }

    return body;
}
