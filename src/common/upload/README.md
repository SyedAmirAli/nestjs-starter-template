# Upload layer

Everything multipart goes through here. Four files:

| File                     | Responsibility                                                                    |
| ------------------------ | --------------------------------------------------------------------------------- |
| `upload-limits.ts`       | Single source of truth for every limit. Named profiles, read from env, validated. |
| `upload.interceptor.ts`  | Runs multer and turns failures into mapped exceptions.                            |
| `multer-error.mapper.ts` | `MulterError.code` → `ApiException`. No message matching.                         |
| `index.ts`               | Public surface. Import from `@/common/upload`, not from the files directly.       |

## Adding an upload endpoint

1. Add a profile to `UPLOAD_PROFILES` in `upload-limits.ts`.
2. Use it in the controller:

```ts
@Post('cases')
@ApiConsumes('multipart/form-data')
@UseInterceptors(SingleFileUpload('document'))
createCase(@UploadedFiles() file: MulterFile) { ... }
```

Use `SingleFileUpload` with `@UploadedFile()`, `MultiFileUpload` with `@UploadedFiles()`.
That is the whole procedure — no module to import, no provider to register, and no
`limits` object to copy. Content rules (mimetype, emptiness) belong in a `ParseFilePipe`
validator; **size never does** — multer already enforces it, so a size branch in a pipe
is unreachable.

## Why not `FileInterceptor` from `@nestjs/platform-express`

It pipes every multer failure through its internal `transformException()`, which
switches on `error.message` and returns a generic `HttpException`. That discards
`MulterError.code` — multer's only stable, documented discriminator — before any
application code can see it. The only way to tell failures apart downstream is then to
match message strings, which are internal constants of `@nestjs/platform-express` and
are _suffixed with the field name_ for the errors that carry one (`"Unexpected field -
images"`), so the matching is both fragile and silently incomplete.

Running multer inside a custom interceptor is the standard NestJS escape hatch and uses
only public API. It is what `FileInterceptor` does internally, minus the lossy error
handling.

## The off-by-one

busboy trips its size limit on `size === limit`, not `size > limit`
(`busboy/lib/types/multipart.js`). Passing `maxFileBytes` straight to multer would
therefore reject a file of exactly that size, making "max 50 MB" wrong by a byte. The
interceptor passes `maxFileBytes + 1` (and `maxFieldValueBytes + 1`) so the profile
values are inclusive, which is how they read. `fieldNameSize` is checked with `>` by
multer itself and needs no adjustment. Covered by the boundary tests.

## nginx is the real outer bound

`client_max_body_size` in `/etc/nginx/sites-available/api.base-app.app` rejects
oversized bodies **before they reach Node**, so no app-level setting can widen it. Its
default is 1 MB, which is what produced the original production 413 — invisible from
the app, because the request never arrived.

That mismatch cannot be caught by a unit test, so it is caught at boot instead:
`PROXY_BODY_LIMIT_BYTES` mirrors the nginx value, and `checkUploadLimits()` (called from
`assertConfig()`) reports any profile whose worst case exceeds it. **When you change
`client_max_body_size`, change `UPLOAD_PROXY_BODY_LIMIT_BYTES` to match.**

Current production values:

```nginx
client_max_body_size 300m;
client_body_timeout  300s;
send_timeout         300s;
proxy_read_timeout   300s;
proxy_send_timeout   300s;
```

Verify a change with a real request rather than by reading config:

```bash
# expect anything except 413
curl -i -X POST https://api.base-app.app/v1/files \
  -F "images=@large.jpg;type=image/jpeg"
```

## Configuration

Every limit is env-overridable and validated by `readIntEnv` (`src/config/env.ts`);
invalid values are reported by `assertConfig()` at boot — fatal in production, a warning
in development — and fall back to the shipped default.

| Variable                                  | Default                   |
| ----------------------------------------- | ------------------------- |
| `UPLOAD_PROXY_BODY_LIMIT_BYTES`           | 300 MB (must match nginx) |
| `UPLOAD_IMAGE_MAX_BYTES`                  | 50 MB                     |
| `UPLOAD_AVATAR_MAX_BYTES`                 | 25 MB                     |
| `UPLOAD_AUDIO_MAX_BYTES`                  | 25 MB                     |
| `UPLOAD_DOCUMENT_MAX_BYTES`               | 50 MB                     |
| `UPLOAD_CATALOG_IMAGE_MAX_BYTES`          | 25 MB                     |
| `UPLOAD_DIAGNOSIS_MAX_FILES`              | 6                         |
| `UPLOAD_CHAT_MAX_FILES`                   | 4                         |
| `UPLOAD_FEED_{IMAGE,VIDEO,PDF}_MAX_BYTES` | 10 / 200 / 25 MB          |

## Known limitations

**memoryStorage.** Every consumer reads `file.buffer` and hands it to
`StorageService.putObject`, so files are buffered in RAM: worst case
`maxFileBytes × maxFiles` per in-flight request. nginx buffers the body to a temp file
first (`proxy_request_buffering` on), so the app only ever sees complete requests, but
concurrent large uploads still multiply. Moving to `diskStorage` or streaming to R2
requires reworking every `file.buffer` consumer.

The feed already shows the better pattern for large media: `presignUpload()` hands the
client a signed R2 URL so the bytes never traverse this process, which is why its video
cap (100 MB) can exceed any multipart profile. That is the direction for large
images if upload concurrency becomes a problem.

**Status codes are pinned for compatibility.** `LIMIT_FILE_SIZE` is 413 and every other
limit is 400, matching what `transformException()` produced before this layer existed.
Arguably `LIMIT_FILE_COUNT` deserves 413 too; changing it would be a breaking API change.

**`MISSING_FIELD_NAME` is unit-tested, not integration-tested.** Triggering it requires
a hand-built multipart body with a nameless part, which no HTTP client will produce.
The mapping is covered in `multer-error.mapper.spec.ts`.
