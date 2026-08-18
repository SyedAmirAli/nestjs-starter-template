/**
 * The app's multipart entry point.
 *
 * ─── Why not @nestjs/platform-express's FileInterceptor ──────────────────────
 * FileInterceptor/FilesInterceptor wrap every multer failure in `transformException()`,
 * which switches on `error.message` and returns a plain HttpException. `MulterError.code`
 * — multer's only stable, documented discriminator — is discarded before any application
 * code can see it, which leaves message-string matching as the only way to distinguish
 * failures downstream. See multer-error.mapper.ts for why that is not viable.
 *
 * Running multer directly inside a custom interceptor is the standard NestJS escape
 * hatch for exactly this, and uses nothing but public API: `multer()` and `MulterError`
 * from multer, and NestInterceptor from @nestjs/common. It is also what
 * FileInterceptor itself does internally, minus the lossy error handling.
 *
 * ─── Why instances rather than a mixin ───────────────────────────────────────
 * These factories return interceptor *instances*, which `@UseInterceptors()` accepts
 * as a documented form. Instances need no DI, so there is no module to import and no
 * provider to register before an endpoint can accept uploads — limits come from the
 * validated UPLOAD_PROFILES constant. The multer middleware is built once when the
 * decorator is evaluated, not per request, and is stateless and safe to share.
 */

import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common';
import type { Observable } from 'rxjs';
import type { Request, RequestHandler, Response } from 'express';
import multer, { memoryStorage } from 'multer';
import { UPLOAD_PROFILES, type UploadProfile, type UploadProfileName } from './upload-limits';
import { mapUploadError } from './multer-error.mapper';

/**
 * Builds the multer middleware for a profile.
 *
 * Every limit multer supports is set explicitly from the profile. Leaving one unset
 * would silently inherit a multer default (`fileSize` defaults to Infinity, `files`
 * and `parts` to Infinity), which is how the unbounded uploads this layer replaced
 * came about.
 */
function buildHandler(profile: UploadProfile, mode: 'single' | 'array'): RequestHandler {
    const instance = multer({
        // memoryStorage: every consumer reads `file.buffer`. See upload-limits.ts.
        storage: memoryStorage(),
        limits: {
            // busboy trips its limit on `fileSize === limit`, not `> limit`
            // (busboy/lib/types/multipart.js), so passing maxFileBytes straight through
            // would reject a file of exactly that size and make "max 50 MB" a lie by one
            // byte. +1 makes the profile value inclusive, which is what it reads as.
            fileSize: profile.maxFileBytes + 1,
            // Same off-by-one applies to field values.
            fieldSize: profile.maxFieldValueBytes + 1,
            files: profile.maxFiles,
            fields: profile.maxFields,
            // `fieldNameSize` is checked with `>` by multer itself, so it is already
            // inclusive and needs no adjustment.
            fieldNameSize: profile.maxFieldNameBytes,
            parts: profile.maxParts,
        },
    });

    return mode === 'single'
        ? instance.single(profile.field)
        : instance.array(profile.field, profile.maxFiles);
}

class UploadInterceptor implements NestInterceptor {
    private readonly handler: RequestHandler;

    constructor(
        private readonly profile: UploadProfile,
        mode: 'single' | 'array',
    ) {
        this.handler = buildHandler(profile, mode);
    }

    async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
        const http = context.switchToHttp();
        const request = http.getRequest<Request>();
        const response = http.getResponse<Response>();

        await new Promise<void>((resolve, reject) => {
            this.handler(request, response, (error?: unknown) => {
                if (error) {
                    // Rejecting from intercept() lets the global exception filter render
                    // the mapped ApiException through the normal error envelope — no
                    // upload-specific handling leaks into unrelated exception paths.
                    reject(mapUploadError(error, this.profile));
                    return;
                }
                resolve();
            });
        });

        return next.handle();
    }
}

/**
 * Builds an interceptor from a profile object rather than a registry name.
 *
 * The seam the two helpers below are built on. Use it when the limits are not a
 * registered profile — a caller computing limits at runtime, or a test exercising the
 * interceptor against deliberately tiny bounds.
 */
export function createUploadInterceptor(profile: UploadProfile, mode: 'single' | 'array'): NestInterceptor {
    return new UploadInterceptor(profile, mode);
}

/**
 * Accepts exactly one file on the profile's field. Pair with `@UploadedFile()`.
 *
 * @example
 *   \@UseInterceptors(SingleFileUpload('avatar'))
 *   setAvatar(\@UploadedFile(avatarParseFilePipe) file: MulterFile) { ... }
 */
export function SingleFileUpload(profile: UploadProfileName): NestInterceptor {
    return createUploadInterceptor(UPLOAD_PROFILES[profile], 'single');
}

/**
 * Accepts up to `maxFiles` files on the profile's field. Pair with `@UploadedFiles()`.
 *
 * @example
 *   \@UseInterceptors(SingleFileUpload('document'))
 *   createCase(\@UploadedFiles() file: MulterFile) { ... }
 */
export function MultiFileUpload(profile: UploadProfileName): NestInterceptor {
    return createUploadInterceptor(UPLOAD_PROFILES[profile], 'array');
}
