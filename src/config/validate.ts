import { Color } from '@/helper/Color';
import {
    AI_API_KEY,
    APP_BASE_URL,
    BACKUP_ENCRYPTION_KEY,
    BETTER_AUTH_SECRET,
    DATABASE_URL,
    PRODUCTION,
    REDIS_URL,
    S3_ACCESS_KEY,
    S3_BUCKET,
    S3_ENDPOINT,
    S3_SECRET_KEY,
} from '@/config/dotenv';
import { getConfigErrors, recordConfigError } from '@/config/env';
import { checkUploadLimits } from '@/common/upload';

type Check = { key: string; value: unknown; required: boolean };

/**
 * Boot must fail loudly on a missing or malformed key. There are no silent defaults for
 * anything below — a service that boots with a null S3 bucket does not fail at boot, it
 * fails on the first user upload, hours later, in production.
 *
 * Validated here: every required secret, every numeric env var parsed through `readIntEnv`
 * (which records rather than throws, so this reports all problems at once instead of failing
 * on whichever module happened to be imported first), and cross-value checks such as upload
 * profiles versus the proxy body limit.
 *
 * In production any problem is fatal. In development it only warns, so local work without
 * every integration wired still runs — numeric values will already have fallen back to their
 * defaults by this point.
 */
export function assertConfig(): void {
    const checks: Check[] = [
        { key: 'DATABASE_URL', value: DATABASE_URL, required: true },
        { key: 'REDIS_URL', value: REDIS_URL, required: true },
        { key: 'BETTER_AUTH_SECRET', value: BETTER_AUTH_SECRET, required: true },
        { key: 'APP_BASE_URL', value: APP_BASE_URL, required: true },
        { key: 'S3_ENDPOINT', value: S3_ENDPOINT, required: true },
        { key: 'S3_BUCKET', value: S3_BUCKET, required: true },
        { key: 'S3_ACCESS_KEY', value: S3_ACCESS_KEY, required: true },
        { key: 'S3_SECRET_KEY', value: S3_SECRET_KEY, required: true },
        { key: 'AI_API_KEY', value: AI_API_KEY, required: true },
        { key: 'BACKUP_ENCRYPTION_KEY', value: BACKUP_ENCRYPTION_KEY, required: true },
    ];

    const missing = checks.filter((c) => c.required && !c.value).map((c) => c.key);

    checkBackupEncryptionKey();

    const problems: string[] = [
        ...(missing.length ? [`Missing required configuration: ${missing.join(', ')}`] : []),
        ...getConfigErrors(),
        ...checkUploadLimits(),
    ];

    if (problems.length === 0) return;

    const message = problems.length === 1 ? problems[0] : `Invalid configuration:\n  - ${problems.join('\n  - ')}`;

    if (PRODUCTION) {
        Color.print(`[config] ${message}`, 'red', { bold: true });
        throw new Error(message);
    }

    Color.print(`[config] ${message} — continuing in development (integrations degraded)`, 'yellow');
}

/**
 * AES-256 needs exactly 32 bytes. A key that is merely *present* but the wrong length fails
 * at the first backup, when the user is watching a progress bar — so the length is checked
 * at boot rather than trusted. Absence is reported by the required-keys check above; this
 * only speaks up when a value exists but cannot possibly work.
 */
function checkBackupEncryptionKey(): void {
    if (!BACKUP_ENCRYPTION_KEY) return;

    const decoded = Buffer.from(BACKUP_ENCRYPTION_KEY, 'base64');
    if (decoded.length !== 32) {
        recordConfigError(
            `BACKUP_ENCRYPTION_KEY must decode to exactly 32 bytes (got ${decoded.length}). ` +
                'Generate one with: openssl rand -base64 32',
        );
    }
}
