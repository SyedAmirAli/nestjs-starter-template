import { HttpException, HttpStatus } from '@nestjs/common';
import { MulterError, type ErrorCode } from 'multer';
import { mapUploadError } from './multer-error.mapper';
import type { UploadProfile } from './upload-limits';

const profile: UploadProfile = {
    name: 'test',
    field: 'images',
    maxFileBytes: 2 * 1024 * 1024,
    maxFiles: 3,
    maxFields: 8,
    maxFieldValueBytes: 1024 * 1024,
    maxFieldNameBytes: 100,
    maxParts: 11,
};

/** Every code @types/multer declares. Kept exhaustive so a new code fails this test. */
const ALL_CODES: ErrorCode[] = [
    'LIMIT_PART_COUNT',
    'LIMIT_FILE_SIZE',
    'LIMIT_FILE_COUNT',
    'LIMIT_FIELD_KEY',
    'LIMIT_FIELD_VALUE',
    'LIMIT_FIELD_COUNT',
    'LIMIT_UNEXPECTED_FILE',
    'MISSING_FIELD_NAME',
];

function bodyOf(error: Error): Record<string, unknown> {
    expect(error).toBeInstanceOf(HttpException);
    return (error as HttpException).getResponse() as Record<string, unknown>;
}

describe('mapUploadError', () => {
    it('maps LIMIT_FILE_SIZE to 413 with the profile limit in the message', () => {
        const mapped = mapUploadError(new MulterError('LIMIT_FILE_SIZE', 'images'), profile);
        const body = bodyOf(mapped);

        expect(body.statusCode).toBe(HttpStatus.PAYLOAD_TOO_LARGE);
        expect(body.code).toBe('UPLOAD_FILE_TOO_LARGE');
        expect(body.localeKey).toBe('error.upload.fileTooLarge');
        expect(body.message).toBe('File is too large. Each file must be 2 MB or smaller.');
    });

    it('maps LIMIT_FILE_COUNT to 400 naming the allowed count', () => {
        const body = bodyOf(mapUploadError(new MulterError('LIMIT_FILE_COUNT'), profile));

        expect(body.statusCode).toBe(HttpStatus.BAD_REQUEST);
        expect(body.code).toBe('UPLOAD_TOO_MANY_FILES');
        expect(body.message).toBe('Too many files. Send at most 3 files per request.');
    });

    it('singularises the file-count message for a single-file profile', () => {
        const single = { ...profile, maxFiles: 1 };
        const body = bodyOf(mapUploadError(new MulterError('LIMIT_FILE_COUNT'), single));

        expect(body.message).toBe('Too many files. Send at most 1 file per request.');
    });

    it('includes the offending field name for LIMIT_UNEXPECTED_FILE', () => {
        const body = bodyOf(mapUploadError(new MulterError('LIMIT_UNEXPECTED_FILE', 'photos'), profile));

        expect(body.statusCode).toBe(HttpStatus.BAD_REQUEST);
        expect(body.code).toBe('UPLOAD_UNEXPECTED_FILE');
        expect(body.message).toContain('"photos"');
        expect(body.message).toContain('"images"');
    });

    it('omits the field clause when multer supplies no field', () => {
        const body = bodyOf(mapUploadError(new MulterError('LIMIT_UNEXPECTED_FILE'), profile));

        expect(body.message).not.toContain('""');
        expect(body.message).toContain('Unexpected file field.');
    });

    (it as any).each([
        ['LIMIT_PART_COUNT', 'UPLOAD_TOO_MANY_PARTS'],
        ['LIMIT_FIELD_COUNT', 'UPLOAD_TOO_MANY_FIELDS'],
        ['LIMIT_FIELD_VALUE', 'UPLOAD_FIELD_VALUE_TOO_LONG'],
        ['LIMIT_FIELD_KEY', 'UPLOAD_FIELD_NAME_TOO_LONG'],
        ['MISSING_FIELD_NAME', 'UPLOAD_MISSING_FIELD_NAME'],
    ] as const)('maps %s to 400 %s', (code, expectedCode) => {
        const body = bodyOf(mapUploadError(new MulterError(code), profile));

        expect(body.statusCode).toBe(HttpStatus.BAD_REQUEST);
        expect(body.code).toBe(expectedCode);
    });

    // Guards the compatibility promise: LIMIT_FILE_SIZE was a 413 and every other limit
    // a 400 before this layer existed, and must stay that way.
    (it as any).each(ALL_CODES)('gives %s a readable message and a stable status', (code) => {
        const body = bodyOf(mapUploadError(new MulterError(code), profile));
        const expected = code === 'LIMIT_FILE_SIZE' ? HttpStatus.PAYLOAD_TOO_LARGE : HttpStatus.BAD_REQUEST;

        expect(body.statusCode).toBe(expected);
        expect(typeof body.message).toBe('string');
        expect((body.message as string).length).toBeGreaterThan(10);
        expect(body.localeKey).toMatch(/^error\.upload\./);
        expect(body.status).toBe('warn');
    });

    it('treats an unparseable multipart body as a 400, not a 500', () => {
        const body = bodyOf(mapUploadError(new Error('Multipart: Boundary not found'), profile));

        expect(body.statusCode).toBe(HttpStatus.BAD_REQUEST);
        expect(body.code).toBe('UPLOAD_MALFORMED_MULTIPART');
    });

    // A storage-engine/OS failure must not be relabelled a client error.
    it('passes system errors through untouched so they surface as 500s', () => {
        const systemError: NodeJS.ErrnoException = Object.assign(new Error('no space left'), {
            errno: -28,
            code: 'ENOSPC',
        });

        expect(mapUploadError(systemError, profile)).toBe(systemError);
    });

    it('always returns an Error, so callers can reject with it', () => {
        expect(mapUploadError('a thrown string', profile)).toBeInstanceOf(Error);
        expect(mapUploadError(undefined, profile)).toBeInstanceOf(Error);
    });
});
