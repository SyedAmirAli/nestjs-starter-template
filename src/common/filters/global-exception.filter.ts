/* eslint-disable @typescript-eslint/no-unsafe-enum-comparison */
import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Request, Response } from 'express';
import { ApiErrorBody, ErrorStatus, MUTATING_HTTP_METHODS } from '@/common/errors/api-error.types';
import { isApiErrorBody } from '@/common/errors/api.exception';
import { normalizeFieldErrors } from '@/common/utils/validation-errors.util';
import { serializeApiErrorBody } from '@/common/utils/serialize-api-error.util';

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
        code: 'CONFLICT',
        status: 'warn',
    },
    [HttpStatus.UNPROCESSABLE_ENTITY]: {
        code: 'VALIDATION_ERROR',
        status: 'warn',
    },
    [HttpStatus.PAYLOAD_TOO_LARGE]: {
        code: 'PAYLOAD_TOO_LARGE',
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

function resolveDefaults(statusCode: number) {
    return (
        DEFAULT_STATUS_CODES[statusCode] ?? {
            code: 'HTTP_ERROR',
            status: resolveDefaultStatus(statusCode),
        }
    );
}

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
    private readonly logger = new Logger(GlobalExceptionFilter.name);

    catch(exception: unknown, host: ArgumentsHost) {
        const ctx = host.switchToHttp();
        const response = ctx.getResponse<Response>();
        const request = ctx.getRequest<Request>();

        const body = this.normalizeException(exception, request.method);

        // The one field the client is told to quote back when reporting a problem. Attached
        // here rather than inside normalizeException so every error path gets it, including
        // the unhandled-exception branch.
        response.status(body.statusCode).json({ ...serializeApiErrorBody(body), requestId: request.requestId });
    }

    private normalizeException(exception: unknown, method: string): ApiErrorBody {
        if (exception instanceof HttpException) {
            return this.fromHttpException(exception, method);
        }

        const defaults = resolveDefaults(HttpStatus.INTERNAL_SERVER_ERROR);

        if (process.env.NODE_ENV !== 'production') {
            this.logger.error(exception instanceof Error ? (exception.stack ?? exception.message) : String(exception));
        }

        return this.buildBody({
            message: 'Something went wrong. Please try again later.',
            code: defaults.code,
            status: defaults.status,
            statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
            errors: null,
        });
    }

    private fromHttpException(exception: HttpException, method: string): ApiErrorBody {
        const statusCode = exception.getStatus();
        const defaults = resolveDefaults(statusCode);
        const raw = exception.getResponse();
        const payload = typeof raw === 'string' ? { message: raw } : (raw as Record<string, unknown>);

        if (isApiErrorBody(payload)) {
            return this.buildBody({
                message: payload.message,
                code: payload.code ?? defaults.code,
                localeKey: payload.localeKey,
                status: payload.status ?? defaults.status,
                statusCode: payload.statusCode,
                errors: this.resolveErrors(method, payload.errors ?? null, null),
                meta: payload.meta,
            });
        }

        const message = this.extractMessage(payload, exception.message);
        const code = typeof payload.code === 'string' ? payload.code : defaults.code;
        const localeKey = typeof payload.localeKey === 'string' ? payload.localeKey : undefined;
        const status = (typeof payload.status === 'string' ? (payload.status as ErrorStatus) : null) ?? defaults.status;

        const fieldErrors = normalizeFieldErrors(payload.errors);
        const validationMessageArray = Array.isArray(payload.message) ? payload.message.map(String) : null;

        const errors = this.resolveErrors(method, fieldErrors, validationMessageArray);

        return this.buildBody({
            message,
            code,
            localeKey,
            status,
            statusCode:
                typeof payload.statusCode === 'number' && payload.statusCode > 0 ? payload.statusCode : statusCode,
            errors,
        });
    }

    private buildBody(body: ApiErrorBody): ApiErrorBody {
        const defaults = resolveDefaults(body.statusCode);

        const normalized: ApiErrorBody = {
            message: body.message,
            statusCode: body.statusCode,
            code: body.code ?? defaults.code,
            status: body.status ?? defaults.status,
            errors: body.errors ?? null,
        };

        if (body.localeKey !== undefined) {
            normalized.localeKey = body.localeKey;
        }

        if (body.meta !== undefined) {
            normalized.meta = body.meta;
        }

        return normalized;
    }

    private resolveErrors(
        method: string,
        fieldErrors: Record<string, string[]> | null,
        validationMessageArray: string[] | null,
    ): Record<string, string[]> | null {
        if (!MUTATING_HTTP_METHODS.has(method.toUpperCase())) {
            return null;
        }

        if (fieldErrors) {
            return fieldErrors;
        }

        if (validationMessageArray?.length) {
            return { body: validationMessageArray };
        }

        return null;
    }

    private extractMessage(payload: Record<string, unknown>, fallback: string): string {
        if (typeof payload.message === 'string') {
            return payload.message;
        }

        if (Array.isArray(payload.message) && payload.message.length) {
            return String(payload.message[0]);
        }

        if (typeof payload.error === 'string') {
            return payload.error;
        }

        return fallback;
    }
}
