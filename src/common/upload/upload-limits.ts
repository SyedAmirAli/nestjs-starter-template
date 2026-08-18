/**
 * Single source of truth for every upload limit in the app.
 *
 * Every upload endpoint resolves its limits from a named profile here — no route declares
 * its own numbers, and no limit is expressed twice. Adding an upload endpoint means adding
 * a profile (or reusing one), never copying a `limits` object.
 *
 * ─── Why the numbers are what they are ────────────────────────────────────────
 * The product's ceiling is 10 MB, and that number is *in the UI copy* on the resume-import
 * screen ("PDF or DOCX, up to 10 MB"). It is not an arbitrary server-side guess, so it is
 * expressed once here and every layer derives from it. A resume or a job description is a
 * text document; a 10 MB PDF is already an outlier full of embedded images.
 *
 * Backup archives are the one exception: an archive is the user's entire account serialized,
 * so it scales with how much they have, not with what they typed.
 *
 * ─── Relationship to the reverse proxy ────────────────────────────────────────
 * nginx enforces `client_max_body_size` before a request ever reaches Node, so it is the
 * true outer bound. PROXY_BODY_LIMIT_BYTES mirrors that value so the app can detect a
 * misconfiguration where a profile permits more than the proxy will pass — which surfaces
 * to users as an unexplained 413 with no app log at all. Keep the two in sync.
 *
 * ─── Memory ───────────────────────────────────────────────────────────────────
 * Multipart profiles use multer's memoryStorage, so worst-case resident bytes per in-flight
 * request is `maxFileBytes * maxFiles`. That is affordable precisely because the multipart
 * path is the *fallback*: the primary upload path is presigned direct-to-S3, where the bytes
 * never enter this process at all. See PRESIGNED_UPLOAD_CAPS below.
 */

import { readIntEnv } from '@/config/env';

const KiB = 1024;
const MiB = 1024 * KiB;

/** Absolute sanity bounds. A value outside these is a typo, not a policy choice. */
const FILE_BYTES_RANGE = { min: 1 * KiB, max: 1024 * MiB };

/**
 * The outer bound enforced by the reverse proxy's `client_max_body_size`. Not enforced by
 * the app — only used to detect profiles that permit more than the proxy will ever deliver.
 */
export const PROXY_BODY_LIMIT_BYTES = readIntEnv('UPLOAD_PROXY_BODY_LIMIT_BYTES', 128 * MiB, {
    min: 1 * MiB,
    max: 4096 * MiB,
});

/** The product-wide document ceiling. Shown verbatim in the mobile app's import screen. */
const DOCUMENT_MAX_BYTES = readIntEnv('UPLOAD_DOCUMENT_MAX_BYTES', 10 * MiB, FILE_BYTES_RANGE);
const AVATAR_MAX_BYTES = readIntEnv('UPLOAD_AVATAR_MAX_BYTES', 5 * MiB, FILE_BYTES_RANGE);
/** A restore upload is a whole account; sized against the backup archive cap, not the doc cap. */
const BACKUP_MAX_BYTES = readIntEnv('UPLOAD_BACKUP_MAX_BYTES', 100 * MiB, FILE_BYTES_RANGE);

/**
 * Non-file part limits, shared by every profile.
 *
 * `fieldNameSize` matches multer's own default (100 bytes) and is stated explicitly so
 * LIMIT_FIELD_KEY has a documented origin rather than an implicit one. `fieldSize` is raised
 * above multer's 1 MB default to leave room for a pasted job description arriving as a form
 * field rather than a file.
 */
const FIELD_NAME_MAX_BYTES = 100;
const FIELD_VALUE_MAX_BYTES = 2 * MiB;
const MAX_FIELDS = 32;

/** The resolved limits for one kind of upload. */
export interface UploadProfile {
    /** Profile name, used in log lines and error messages. */
    readonly name: string;
    /** Multipart field the file(s) arrive on. */
    readonly field: string;
    /** Max bytes for any single file. Enforced by multer -> LIMIT_FILE_SIZE. */
    readonly maxFileBytes: number;
    /** Max number of files in one request. Enforced by multer -> LIMIT_FILE_COUNT. */
    readonly maxFiles: number;
    /** Max non-file fields. Enforced by multer -> LIMIT_FIELD_COUNT. */
    readonly maxFields: number;
    /** Max bytes in one field value. Enforced by multer -> LIMIT_FIELD_VALUE. */
    readonly maxFieldValueBytes: number;
    /** Max bytes in one field name. Enforced by multer -> LIMIT_FIELD_KEY. */
    readonly maxFieldNameBytes: number;
    /** Max total parts (files + fields). Enforced by multer -> LIMIT_PART_COUNT. */
    readonly maxParts: number;
}

function defineProfile(name: string, field: string, maxFileBytes: number, maxFiles: number): UploadProfile {
    return {
        name,
        field,
        maxFileBytes,
        maxFiles,
        maxFields: MAX_FIELDS,
        maxFieldValueBytes: FIELD_VALUE_MAX_BYTES,
        maxFieldNameBytes: FIELD_NAME_MAX_BYTES,
        // Every file and every field is one part; allow exactly what the two individual
        // limits already permit, so LIMIT_PART_COUNT only fires for requests that are
        // malformed rather than merely large.
        maxParts: maxFiles + MAX_FIELDS,
    };
}

/**
 * Every multipart upload surface in the app. Adding an endpoint means adding an entry here
 * and referencing it from the controller — nothing else.
 *
 * This is the *fallback* path (`POST /files`), for environments where a presigned PUT to S3
 * is blocked by an egress policy. The primary path is presigned direct upload.
 */
export const UPLOAD_PROFILES = {
    /** Resume or job-description document (PDF/DOCX) proxied through the API. */
    document: defineProfile('document', 'file', DOCUMENT_MAX_BYTES, 1),
    /** Profile photo. */
    avatar: defineProfile('avatar', 'file', AVATAR_MAX_BYTES, 1),
    /** `.glowquest-backup` archive being restored. */
    backupRestore: defineProfile('backupRestore', 'file', BACKUP_MAX_BYTES, 1),
} as const satisfies Record<string, UploadProfile>;

export type UploadProfileName = keyof typeof UPLOAD_PROFILES;

/**
 * Caps for presigned direct-to-S3 uploads — the primary upload path.
 *
 * A different mechanism from the profiles above, and deliberately kept distinct rather than
 * merged: these bytes never pass through this process. The client declares a size, we reject
 * it before handing back a signed URL, and S3 receives the file directly. That is why the
 * archive cap may far exceed any multipart profile — no proxy body limit and no server RAM
 * is involved.
 *
 * The declared `mime` is checked here to avoid issuing a URL for something we would only
 * reject later. It is NOT evidence: a client-declared content type is a claim, so the
 * `complete` step re-verifies with a magic-byte sniff of the stored object before the file
 * is ever marked READY.
 *
 * They live here so that every upload size policy in the app has one home.
 */
export const PRESIGNED_UPLOAD_CAPS = {
    /** Screen 05/06 — an uploaded CV awaiting parse. */
    resume: {
        maxBytes: readIntEnv('UPLOAD_RESUME_MAX_BYTES', 10 * MiB, FILE_BYTES_RANGE),
        mime: /^application\/(pdf|vnd\.openxmlformats-officedocument\.wordprocessingml\.document)$/i,
    },
    /** Screen 17 — a job description supplied as a file rather than pasted text. */
    jobDescription: {
        maxBytes: readIntEnv('UPLOAD_JD_MAX_BYTES', 10 * MiB, FILE_BYTES_RANGE),
        mime: /^(application\/(pdf|vnd\.openxmlformats-officedocument\.wordprocessingml\.document)|text\/plain)$/i,
    },
    avatar: {
        maxBytes: readIntEnv('UPLOAD_AVATAR_MAX_BYTES', 5 * MiB, FILE_BYTES_RANGE),
        mime: /^image\/(jpe?g|png|webp|heic|heif)$/i,
    },
    /** Screen 30 — restoring an archive we produced. Opaque octet-stream by design. */
    backupArchive: {
        maxBytes: readIntEnv('UPLOAD_BACKUP_MAX_BYTES', 100 * MiB, FILE_BYTES_RANGE),
        mime: /^application\/octet-stream$/i,
    },
} as const satisfies Record<string, { maxBytes: number; mime: RegExp }>;

export type PresignedUploadKind = keyof typeof PRESIGNED_UPLOAD_CAPS;

/** Bytes -> "10 MB" / "512 KB", for user-facing error messages and Swagger text. */
export function formatBytes(bytes: number): string {
    if (bytes >= MiB) {
        const mb = bytes / MiB;
        return `${Number.isInteger(mb) ? mb : mb.toFixed(1)} MB`;
    }
    return `${Math.round(bytes / KiB)} KB`;
}

/**
 * Cross-checks each profile against the proxy body limit.
 *
 * A profile that permits more than the proxy will pass is not an app-level error — the
 * request dies upstream — but it is always a misconfiguration, and it is invisible from the
 * app's own logs, which is exactly how such a 413 goes undiagnosed. So surface it at boot.
 * Returns problems rather than printing them, so `assertConfig()` stays the single place
 * that decides fatal-vs-warn.
 *
 * Individual env values are already validated by `readIntEnv`; this only covers the
 * relationship *between* values, which no single-variable check can catch.
 */
export function checkUploadLimits(proxyLimitBytes: number = PROXY_BODY_LIMIT_BYTES): string[] {
    const problems: string[] = [];

    for (const profile of Object.values(UPLOAD_PROFILES)) {
        const worstCase = profile.maxFileBytes * profile.maxFiles;
        if (worstCase > proxyLimitBytes) {
            problems.push(
                `upload profile "${profile.name}" allows up to ${formatBytes(worstCase)} ` +
                    `(${profile.maxFiles} x ${formatBytes(profile.maxFileBytes)}) but the proxy body limit is ` +
                    `${formatBytes(proxyLimitBytes)} — raise nginx client_max_body_size or lower the profile`,
            );
        }
    }

    return problems;
}
