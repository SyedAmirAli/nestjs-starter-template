/**
 * Translates multer failures into the app's standard error envelope.
 *
 * ─── Why this exists ─────────────────────────────────────────────────────────
 * @nestjs/platform-express's FileInterceptor pipes every multer failure through its
 * internal `transformException()`, which switches on `error.message` and returns a
 * generic HttpException. That throws away `MulterError.code` — the only stable,
 * documented discriminator multer offers — leaving message-string matching as the
 * sole way to tell one failure from another downstream. Message strings are internal
 * constants of @nestjs/platform-express, and for the errors that carry a field name
 * the message is suffixed (`"Unexpected field - images"`), so matching them is both
 * fragile and quietly incomplete.
 *
 * This mapper is reached instead by running multer ourselves (see upload.interceptor.ts),
 * so `MulterError.code` is still intact. Every branch below is keyed on that code.
 *
 * ─── Status-code compatibility ───────────────────────────────────────────────
 * The HTTP status for each code deliberately matches what transformException()
 * produced before this layer existed — LIMIT_FILE_SIZE stays 413, every other limit
 * stays 400 — so no client sees a status it did not see before. Only the message and
 * the machine-readable `code`/`localeKey` improve.
 */

import { HttpStatus } from '@nestjs/common';
import { MulterError, type ErrorCode } from 'multer';
import { ApiException } from '@/common/errors/api.exception';
import { formatBytes, type UploadProfile } from './upload-limits';

/**
 * Every error code multer can raise, taken from @types/multer rather than restated here
 * so the two can never drift. A multer upgrade that adds a code turns ERROR_MAP below
 * into a compile error — which is the failure mode we want.
 */
export type MulterErrorCode = ErrorCode;

interface MappedError {
    statusCode: number;
    code: string;
    localeKey: string;
    message: (profile: UploadProfile, field?: string) => string;
}

/**
 * One entry per multer error code — exhaustive by construction: the `Record` type
 * makes omitting a code a compile error, so a multer upgrade that adds a code
 * cannot silently fall through to a generic 500.
 */
const ERROR_MAP: Record<MulterErrorCode, MappedError> = {
    LIMIT_FILE_SIZE: {
        statusCode: HttpStatus.PAYLOAD_TOO_LARGE,
        code: 'UPLOAD_FILE_TOO_LARGE',
        localeKey: 'error.upload.fileTooLarge',
        message: (p) => `File is too large. Each file must be ${formatBytes(p.maxFileBytes)} or smaller.`,
    },
    LIMIT_FILE_COUNT: {
        statusCode: HttpStatus.BAD_REQUEST,
        code: 'UPLOAD_TOO_MANY_FILES',
        localeKey: 'error.upload.tooManyFiles',
        message: (p) => `Too many files. Send at most ${p.maxFiles} file${p.maxFiles === 1 ? '' : 's'} per request.`,
    },
    LIMIT_UNEXPECTED_FILE: {
        statusCode: HttpStatus.BAD_REQUEST,
        code: 'UPLOAD_UNEXPECTED_FILE',
        localeKey: 'error.upload.unexpectedFile',
        message: (p, field) =>
            `Unexpected file field${field ? ` "${field}"` : ''}. Send files in the "${p.field}" field, ` +
            `at most ${p.maxFiles} per request.`,
    },
    LIMIT_PART_COUNT: {
        statusCode: HttpStatus.BAD_REQUEST,
        code: 'UPLOAD_TOO_MANY_PARTS',
        localeKey: 'error.upload.tooManyParts',
        message: (p) => `Too many parts in the upload. Send at most ${p.maxParts} files and fields combined.`,
    },
    LIMIT_FIELD_COUNT: {
        statusCode: HttpStatus.BAD_REQUEST,
        code: 'UPLOAD_TOO_MANY_FIELDS',
        localeKey: 'error.upload.tooManyFields',
        message: (p) => `Too many form fields. Send at most ${p.maxFields}.`,
    },
    LIMIT_FIELD_VALUE: {
        statusCode: HttpStatus.BAD_REQUEST,
        code: 'UPLOAD_FIELD_VALUE_TOO_LONG',
        localeKey: 'error.upload.fieldValueTooLong',
        message: (p, field) =>
            `The value of field${field ? ` "${field}"` : ''} is too long. ` +
            `Maximum ${formatBytes(p.maxFieldValueBytes)} per field.`,
    },
    LIMIT_FIELD_KEY: {
        statusCode: HttpStatus.BAD_REQUEST,
        code: 'UPLOAD_FIELD_NAME_TOO_LONG',
        localeKey: 'error.upload.fieldNameTooLong',
        message: (p) => `A form field name is too long. Maximum ${p.maxFieldNameBytes} characters.`,
    },
    MISSING_FIELD_NAME: {
        statusCode: HttpStatus.BAD_REQUEST,
        code: 'UPLOAD_MISSING_FIELD_NAME',
        localeKey: 'error.upload.missingFieldName',
        message: () => 'A part of the upload is missing its field name.',
    },
};

/**
 * True for errors that came from the OS rather than from parsing the request.
 *
 * multer surfaces storage-engine failures through the same callback as parse
 * failures. Node system errors carry a numeric `errno`; busboy/multer parse errors
 * never do. Using that rather than the message text keeps a genuine server fault
 * (ENOSPC, EACCES) reporting as a 500 instead of being mislabelled a client error.
 */
function isSystemError(error: unknown): error is NodeJS.ErrnoException {
    return error instanceof Error && typeof (error as NodeJS.ErrnoException).errno === 'number';
}

/**
 * Maps any error raised by the multer middleware onto an ApiException.
 *
 * Returns the original error untouched when it is a genuine server fault, so the global
 * filter reports it as a 500 rather than this layer guessing. Always returns an Error,
 * so callers can reject with it directly.
 */
export function mapUploadError(error: unknown, profile: UploadProfile): Error {
    if (error instanceof MulterError) {
        // Annotated as possibly-undefined on purpose: the Record is exhaustive over the
        // codes @types/multer knows about, but a multer upgrade ahead of its types would
        // produce a code with no entry. That is a real (if rare) runtime path, not a
        // hypothetical one, so it gets a real branch rather than a crash.
        const mapped: MappedError | undefined = ERROR_MAP[error.code];

        if (!mapped) {
            return new ApiException({
                statusCode: HttpStatus.BAD_REQUEST,
                message: 'The upload could not be processed.',
                code: 'UPLOAD_REJECTED',
                localeKey: 'error.upload.rejected',
                status: 'warn',
            });
        }

        return new ApiException({
            statusCode: mapped.statusCode,
            message: mapped.message(profile, error.field),
            code: mapped.code,
            localeKey: mapped.localeKey,
            status: 'warn',
        });
    }

    if (isSystemError(error)) return error;

    // Not a MulterError and not a system error: busboy rejected the stream, e.g. a
    // missing or malformed multipart boundary, or a truncated body. That is a client
    // error, so a 400 is correct — a 500 here would page someone for a bad request.
    return new ApiException({
        statusCode: HttpStatus.BAD_REQUEST,
        message: 'The upload could not be read. Send a well-formed multipart/form-data request.',
        code: 'UPLOAD_MALFORMED_MULTIPART',
        localeKey: 'error.upload.malformedMultipart',
        status: 'warn',
    });
}
