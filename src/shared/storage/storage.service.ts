import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
    DeleteObjectCommand,
    DeleteObjectsCommand,
    GetObjectCommand,
    HeadObjectCommand,
    ListObjectsV2Command,
    PutObjectCommand,
    S3Client,
    type PutObjectCommandInput,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
    S3_ACCESS_KEY,
    S3_BUCKET,
    S3_ENDPOINT,
    S3_PREFIX,
    S3_PUBLIC_BASE_URL,
    S3_REGION,
    S3_SECRET_KEY,
} from '@/config/dotenv';
import { ApiException } from '@/common/errors';
import LogFile from '@/helper/LogFile';

/** Uploads are short-lived on purpose: a presigned URL is a bearer token for that object. */
const DEFAULT_UPLOAD_TTL_SECONDS = 15 * 60;
/** Downloads are shorter still — the client uses the URL immediately or asks for a new one. */
const DEFAULT_DOWNLOAD_TTL_SECONDS = 5 * 60;

export type SignedUploadUrl = {
    key: string;
    url: string;
    method: 'PUT';
    expiresIn: number;
    expiresAt: string;
};

export type ObjectHead = {
    exists: boolean;
    sizeBytes: number | null;
    contentType: string | null;
    etag: string | null;
};

/**
 * Object storage over an S3-compatible API (Cloudflare R2 in production, MinIO in dev).
 *
 * Binaries — uploaded resumes, rendered PDFs, backup archives, data exports — live here;
 * only their keys and metadata live in Postgres. The bucket is private: there is no public
 * read and no public listing, and every access is a short-lived presigned URL.
 *
 * Clients upload *directly* to S3 via a signed PUT, so a 10 MB PDF never transits this
 * process. That is not only a bandwidth decision: the client owns the byte count, which is
 * what makes an honest upload progress bar possible at all.
 *
 * Keys are laid out prefix-per-user (`users/{userId}/...`) precisely so account deletion is
 * a prefix sweep rather than a join across every table that might reference a file.
 */
@Injectable()
export class StorageService {
    private readonly bucket = S3_BUCKET;
    /** Shared-bucket namespace — every object key is rooted here (default: `base-app`). */
    readonly prefix = S3_PREFIX;

    /** Built once and reused: an S3Client holds a connection pool, so per-call construction
     *  would open a fresh socket for every upload. */
    private cachedClient: S3Client | null = null;

    private log(...args: unknown[]) {
        LogFile.custom(StorageService.name, ...args);
    }

    private get client(): S3Client {
        if (this.cachedClient) return this.cachedClient;

        // Re-checked here rather than trusted from assertConfig(): in development a missing
        // key is only a warning, so this is the point where it must become a hard error
        // instead of an opaque SDK failure.
        if (!S3_BUCKET) throw new Error('S3_BUCKET is not set');
        if (!S3_ENDPOINT) throw new Error('S3_ENDPOINT is not set');
        if (!S3_ACCESS_KEY) throw new Error('S3_ACCESS_KEY is not set');
        if (!S3_SECRET_KEY) throw new Error('S3_SECRET_KEY is not set');

        this.cachedClient = new S3Client({
            region: S3_REGION,
            endpoint: S3_ENDPOINT,
            credentials: { accessKeyId: S3_ACCESS_KEY, secretAccessKey: S3_SECRET_KEY },
        });

        return this.cachedClient;
    }

    /**
     * Ensures every object key lives under the app prefix inside the (possibly shared) bucket.
     * Idempotent — keys that already start with `base-app/` are left unchanged, so it is safe
     * to call on a key read back out of the database.
     */
    resolveKey(key: string): string {
        const normalized = key.replace(/^\/+/, '');
        if (!this.prefix) return normalized;
        if (normalized === this.prefix || normalized.startsWith(`${this.prefix}/`)) {
            return normalized;
        }
        return `${this.prefix}/${normalized}`;
    }

    /**
     * Builds a collision-resistant object key under a user's own prefix.
     *
     * e.g. `userKey(userId, 'uploads', 'pdf')` -> `base-app/users/<userId>/uploads/<uuid>.pdf`
     *
     * The `users/{userId}/` segment is the whole point: deleting an account is then one
     * prefix delete, with no way to miss an object because a table forgot to reference it.
     */
    userKey(userId: string, namespace: string, extension?: string): string {
        const base = [this.prefix, 'users', userId, namespace].filter(Boolean).join('/');
        const name = randomUUID();
        return extension ? `${base}/${name}.${extension}` : `${base}/${name}`;
    }

    /** Every object belonging to a user. Pass to {@link deletePrefix} on account deletion. */
    userPrefix(userId: string): string {
        return [this.prefix, 'users', userId].filter(Boolean).join('/') + '/';
    }

    /**
     * Short-lived signed URL for a direct client-side PUT.
     *
     * `contentType` is baked into the signature, so a client that declared `application/pdf`
     * at intent time cannot then upload with a different content type — S3 itself rejects
     * the mismatch. That is a cheap first gate; the authoritative check is the magic-byte
     * sniff performed after the upload completes.
     */
    async getSignedUploadUrl(
        key: string,
        contentType: string,
        expiresIn = DEFAULT_UPLOAD_TTL_SECONDS,
    ): Promise<SignedUploadUrl> {
        const resolvedKey = this.resolveKey(key);
        const command = new PutObjectCommand({ Bucket: this.bucket!, Key: resolvedKey, ContentType: contentType });
        const url = await getSignedUrl(this.client, command, { expiresIn });

        return {
            key: resolvedKey,
            url,
            method: 'PUT',
            expiresIn,
            expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
        };
    }

    /**
     * Short-lived signed URL for reading a private object.
     *
     * `filename` bakes a `Content-Disposition: attachment` into the signature so the OS saves
     * the file under its original name rather than the opaque UUID key. Ownership must be
     * checked *before* calling this — signing is the security boundary; once a URL exists,
     * anyone holding it can read the object until it expires.
     */
    async getSignedDownloadUrl(
        key: string,
        options: { expiresIn?: number; filename?: string } = {},
    ): Promise<{ url: string; expiresAt: string }> {
        const expiresIn = options.expiresIn ?? DEFAULT_DOWNLOAD_TTL_SECONDS;
        const command = new GetObjectCommand({
            Bucket: this.bucket!,
            Key: this.resolveKey(key),
            ResponseContentDisposition: options.filename
                ? `attachment; filename="${options.filename.replace(/"/g, '')}"`
                : undefined,
        });

        return {
            url: await getSignedUrl(this.client, command, { expiresIn }),
            expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
        };
    }

    /**
     * Reads an object's metadata without transferring it.
     *
     * This is what makes the `complete` step of a direct upload trustworthy: the client tells
     * us it uploaded 253,952 bytes of PDF, and this is how we find out whether it did.
     * A missing object returns `exists: false` rather than throwing — "the client never
     * finished the PUT" is an expected outcome, not an error condition.
     */
    async headObject(key: string): Promise<ObjectHead> {
        try {
            const result = await this.client.send(
                new HeadObjectCommand({ Bucket: this.bucket!, Key: this.resolveKey(key) }),
            );
            return {
                exists: true,
                sizeBytes: result.ContentLength ?? null,
                contentType: result.ContentType ?? null,
                etag: result.ETag ?? null,
            };
        } catch {
            return { exists: false, sizeBytes: null, contentType: null, etag: null };
        }
    }

    /** Server-side upload — rendered PDFs, backup archives, anything we generate ourselves. */
    async putObject(key: string, body: PutObjectCommandInput['Body'], contentType?: string): Promise<{ key: string }> {
        const resolvedKey = this.resolveKey(key);
        const options: PutObjectCommandInput = {
            Bucket: this.bucket!,
            Key: resolvedKey,
            Body: body,
            ContentType: contentType,
        };

        try {
            await this.client.send(new PutObjectCommand(options));
            return { key: resolvedKey };
        } catch (error) {
            this.log('putObject.failed', { key, error: String(error) });

            throw new ApiException({
                statusCode: 503,
                message: 'Object storage is unavailable. Please try again shortly.',
                code: 'STORAGE_UNAVAILABLE',
                status: 'critical',
            });
        }
    }

    /** Fetches an object body as a Buffer. Only for objects we know are small — parse input,
     *  archive manifests. Never stream a user download through this process. */
    async getObject(key: string): Promise<Buffer> {
        const result = await this.client.send(
            new GetObjectCommand({ Bucket: this.bucket!, Key: this.resolveKey(key) }),
        );
        const bytes = await result.Body?.transformToByteArray();
        if (!bytes) throw new Error(`Empty object body for key: ${key}`);
        return Buffer.from(bytes);
    }

    /**
     * Reads only the first `length` bytes of an object.
     *
     * Used for the magic-byte sniff at upload completion — a `%PDF` header or a ZIP local
     * file header for DOCX. Pulling the whole object to inspect four bytes would mean
     * transferring 10 MB to reject a file we are about to delete anyway.
     */
    async getObjectHead(key: string, length = 8): Promise<Buffer> {
        const result = await this.client.send(
            new GetObjectCommand({
                Bucket: this.bucket!,
                Key: this.resolveKey(key),
                Range: `bytes=0-${length - 1}`,
            }),
        );
        const bytes = await result.Body?.transformToByteArray();
        return Buffer.from(bytes ?? []);
    }

    async deleteObject(key: string): Promise<void> {
        await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket!, Key: this.resolveKey(key) }));
    }

    /**
     * Deletes every object under a prefix — the account-deletion primitive.
     *
     * Paginates because `ListObjectsV2` caps at 1000 keys per response and a maximal account
     * exceeds that; deletes in batches of 1000 because that is `DeleteObjects`' own limit.
     * Returns the count so the caller can record it in the audit trail: "deleted the account"
     * and "deleted the account and 412 objects" are different claims.
     */
    async deletePrefix(prefix: string): Promise<number> {
        const resolvedPrefix = this.resolveKey(prefix);
        let continuationToken: string | undefined;
        let deleted = 0;

        do {
            const listed = await this.client.send(
                new ListObjectsV2Command({
                    Bucket: this.bucket!,
                    Prefix: resolvedPrefix,
                    ContinuationToken: continuationToken,
                }),
            );

            const keys = (listed.Contents ?? []).map((o) => ({ Key: o.Key! })).filter((o) => o.Key);
            if (keys.length) {
                await this.client.send(
                    new DeleteObjectsCommand({ Bucket: this.bucket!, Delete: { Objects: keys, Quiet: true } }),
                );
                deleted += keys.length;
            }

            // Only follow the cursor while the listing says it is truncated; an empty page
            // with a stale token would otherwise loop forever.
            continuationToken = listed.IsTruncated ? listed.NextContinuationToken : undefined;
        } while (continuationToken);

        return deleted;
    }

    /**
     * Public URL for a key, when a public base URL is configured.
     *
     * Returns null by default, and that is the correct answer for user content: the bucket is
     * private, so there is no public URL to hand out. Only ever use this for assets that are
     * deliberately world-readable.
     */
    publicUrl(key: string): string | null {
        if (!S3_PUBLIC_BASE_URL) return null;
        return `${S3_PUBLIC_BASE_URL.replace(/\/$/, '')}/${this.resolveKey(key)}`;
    }
}
