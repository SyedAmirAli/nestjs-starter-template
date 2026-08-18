import { Body, Controller, Post, UploadedFile, UploadedFiles, UseInterceptors } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { GlobalExceptionFilter } from '@/common/filters/global-exception.filter';
import { createUploadInterceptor } from './upload.interceptor';
import type { UploadProfile } from './upload-limits';

/**
 * Deliberately tiny limits so the real multer/busboy pipeline can be driven past every
 * boundary in milliseconds. The production numbers are exercised by upload-limits.spec.ts;
 * what matters here is that each limit produces the right error code end to end.
 */
const MULTI: UploadProfile = {
    name: 'test-multi',
    field: 'images',
    maxFileBytes: 1024,
    maxFiles: 2,
    maxFields: 2,
    maxFieldValueBytes: 32,
    maxFieldNameBytes: 10,
    maxParts: 10,
};

const SINGLE: UploadProfile = { ...MULTI, name: 'test-single', field: 'file', maxFiles: 1 };

/** Separate profile so the parts limit trips before the file/field limits do. */
const PARTS: UploadProfile = { ...MULTI, name: 'test-parts', maxParts: 2, maxFields: 5, maxFiles: 3 };

declare global {
    function describe(description: string, fn: () => any): any;
    function it(description: string, fn: () => any): any;
    function beforeAll(fn: () => any): any;
    function afterAll(fn: () => any): any;
    function expect(value: any): any;
}

@Controller('t')
class UploadTestController {
    @Post('multi')
    @UseInterceptors(createUploadInterceptor(MULTI, 'array'))
    multi(@UploadedFiles() files?: Express.Multer.File[], @Body() body?: Record<string, unknown>) {
        return { count: files?.length ?? 0, sizes: (files ?? []).map((f) => f.size), body: body ?? {} };
    }

    @Post('single')
    @UseInterceptors(createUploadInterceptor(SINGLE, 'single'))
    single(@UploadedFile() file?: Express.Multer.File) {
        return { name: file?.originalname ?? null, size: file?.size ?? 0 };
    }

    @Post('parts')
    @UseInterceptors(createUploadInterceptor(PARTS, 'array'))
    parts(@UploadedFiles() files?: Express.Multer.File[]) {
        return { count: files?.length ?? 0 };
    }
}

describe('upload interceptor (integration)', () => {
    let app: INestApplication;

    beforeAll(async () => {
        const moduleRef = await Test.createTestingModule({ controllers: [UploadTestController] }).compile();
        app = moduleRef.createNestApplication();
        app.useGlobalFilters(new GlobalExceptionFilter());
        await app.init();
    });

    afterAll(async () => {
        await app?.close();
    });

    const http = () => request(app.getHttpServer());
    const file = (bytes: number) => Buffer.alloc(bytes, 0x61);

    describe('successful uploads', () => {
        it('accepts a single file under the limit', async () => {
            const res = await http().post('/t/single').attach('file', file(512), 'photo.jpg').expect(201);

            expect(res.body).toEqual({ name: 'photo.jpg', size: 512 });
        });

        it('accepts the maximum number of files', async () => {
            const res = await http()
                .post('/t/multi')
                .attach('images', file(100), 'a.jpg')
                .attach('images', file(200), 'b.jpg')
                .expect(201);

            expect(res.body.count).toBe(2);
            expect(res.body.sizes).toEqual([100, 200]);
        });

        it('passes text fields through to the body alongside the files', async () => {
            const res = await http()
                .post('/t/multi')
                .field('note', 'leaf spots')
                .attach('images', file(64), 'a.jpg')
                .expect(201);

            expect(res.body.count).toBe(1);
            expect(res.body.body).toMatchObject({ note: 'leaf spots' });
        });

        it('accepts a request with no files at all', async () => {
            const res = await http().post('/t/multi').field('note', 'text only').expect(201);

            expect(res.body.count).toBe(0);
        });
    });

    describe('boundary values', () => {
        it('accepts a file of exactly maxFileBytes', async () => {
            const res = await http()
                .post('/t/single')
                .attach('file', file(MULTI.maxFileBytes), 'exact.jpg')
                .expect(201);

            expect(res.body.size).toBe(MULTI.maxFileBytes);
        });

        it('rejects a file one byte over maxFileBytes', async () => {
            const res = await http()
                .post('/t/single')
                .attach('file', file(MULTI.maxFileBytes + 1), 'over.jpg')
                .expect(413);

            expect(res.body.code).toBe('UPLOAD_FILE_TOO_LARGE');
        });

        it('accepts a field value of exactly maxFieldValueBytes', async () => {
            await http().post('/t/multi').field('note', 'x'.repeat(MULTI.maxFieldValueBytes)).expect(201);
        });

        it('accepts a field name of exactly maxFieldNameBytes', async () => {
            await http().post('/t/multi').field('n'.repeat(MULTI.maxFieldNameBytes), 'v').expect(201);
        });
    });

    describe('limit violations', () => {
        it('LIMIT_FILE_SIZE -> 413 with a readable message', async () => {
            const res = await http().post('/t/single').attach('file', file(4096), 'big.jpg').expect(413);

            expect(res.body).toMatchObject({
                statusCode: 413,
                code: 'UPLOAD_FILE_TOO_LARGE',
                localeKey: 'error.upload.fileTooLarge',
                status: 'warn',
            });
            expect(res.body.message).toBe('File is too large. Each file must be 1 KB or smaller.');
        });

        it('LIMIT_FILE_COUNT -> 400', async () => {
            const res = await http()
                .post('/t/multi')
                .attach('images', file(10), 'a.jpg')
                .attach('images', file(10), 'b.jpg')
                .attach('images', file(10), 'c.jpg')
                .expect(400);

            expect(res.body.code).toBe('UPLOAD_TOO_MANY_FILES');
            expect(res.body.message).toContain('at most 2 files');
        });

        it('LIMIT_UNEXPECTED_FILE -> 400 naming both fields', async () => {
            const res = await http().post('/t/multi').attach('photos', file(10), 'a.jpg').expect(400);

            expect(res.body.code).toBe('UPLOAD_UNEXPECTED_FILE');
            expect(res.body.message).toContain('"photos"');
            expect(res.body.message).toContain('"images"');
        });

        it('LIMIT_FIELD_COUNT -> 400', async () => {
            const res = await http().post('/t/multi').field('a', '1').field('b', '2').field('c', '3').expect(400);

            expect(res.body.code).toBe('UPLOAD_TOO_MANY_FIELDS');
        });

        it('LIMIT_FIELD_VALUE -> 400', async () => {
            const res = await http()
                .post('/t/multi')
                .field('note', 'x'.repeat(MULTI.maxFieldValueBytes + 1))
                .expect(400);

            expect(res.body.code).toBe('UPLOAD_FIELD_VALUE_TOO_LONG');
        });

        it('LIMIT_FIELD_KEY -> 400', async () => {
            const res = await http()
                .post('/t/multi')
                .field('n'.repeat(MULTI.maxFieldNameBytes + 1), 'v')
                .expect(400);

            expect(res.body.code).toBe('UPLOAD_FIELD_NAME_TOO_LONG');
        });

        it('LIMIT_PART_COUNT -> 400', async () => {
            const res = await http()
                .post('/t/parts')
                .attach('images', file(10), 'a.jpg')
                .field('a', '1')
                .field('b', '2')
                .expect(400);

            expect(res.body.code).toBe('UPLOAD_TOO_MANY_PARTS');
        });
    });

    describe('malformed requests', () => {
        it('treats an unreadable multipart body as a 400, never a 500', async () => {
            const res = await http()
                .post('/t/multi')
                .set('Content-Type', 'multipart/form-data')
                .send('not actually multipart');

            expect(res.status).toBe(400);
            expect(res.body.code).toBe('UPLOAD_MALFORMED_MULTIPART');
        });
    });
});
