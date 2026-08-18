import { Color } from '@/helper/Color';
import { configDotenv } from 'dotenv';
import { join } from 'node:path';

// __dirname is dist/config at runtime and src/config under ts-node, so ../../ lands on the
// project root either way.
const path = join(__dirname, '../../.env');
configDotenv({ path });

export const NODE_ENV = process.env['NODE_ENV'] ?? 'development';
export const PRODUCTION = NODE_ENV === 'production';
export const DEVELOPMENT = NODE_ENV === 'development';
export const TEST = NODE_ENV === 'test';
export const PORT = Number(process.env['PORT'] ?? 4000);
export const HOST = process.env['HOST'] ?? '0.0.0.0';

export const APP_NAME = process.env['APP_NAME'] ?? 'glowquest';
export const APP_VERSION = process.env['APP_VERSION'] ?? '1.0.0';

/** Public origin of this API. Used for deep links in notifications and OAuth redirects. */
export const APP_BASE_URL = process.env['APP_BASE_URL'] ?? `http://localhost:${PORT}`;

/**
 * Allowed browser origins, comma-separated. `*` (the default) reflects whatever origin
 * asks — convenient in dev, where the Expo client and any local tooling hit :4000 from
 * arbitrary origins.
 *
 * NOTE: `*` here does NOT emit `Access-Control-Allow-Origin: *`. Clients send credentials,
 * and browsers reject a literal wildcard on credentialed requests — so main.ts reflects the
 * caller's origin instead. That is strictly more permissive than a wildcard: any site a
 * logged-in user visits can call this API with their cookies. Lock this to real origins
 * before production.
 */
export const CORS_ORIGINS = process.env['CORS_ORIGINS'] ?? '*';

/* ------------------------------------------------------------------ Database */

const DB_PROVIDERS = ['postgresql', 'mysql', 'sqlite', 'sqlserver', 'cockroachdb', 'mongodb'] as const;
type DBProvider = (typeof DB_PROVIDERS)[number];

const _DATABASE_PROVIDER = (process.env['DATABASE_PROVIDER'] ?? null) as DBProvider;
export const DATABASE_PROVIDER: DBProvider =
    _DATABASE_PROVIDER && DB_PROVIDERS.includes(_DATABASE_PROVIDER) ? _DATABASE_PROVIDER : DB_PROVIDERS[0];

/**
 * Decomposed parts exist so a container can override only the host (see docker-compose.yml):
 * DATABASE_URL hardcodes "localhost", which inside a container resolves to the container
 * itself. When DATABASE_URL is set it wins outright.
 */
export const DATABASE_HOST = process.env['DATABASE_HOST'] ?? 'localhost';
export const DATABASE_PORT = Number(process.env['DATABASE_PORT'] ?? 5432);
export const DATABASE_NAME = process.env['DATABASE_NAME'] ?? 'glowquest_backend';
export const DATABASE_USERNAME = process.env['DATABASE_USERNAME'] ?? 'glowquest';
export const DATABASE_PASSWORD = process.env['DATABASE_PASSWORD'] ?? 'glowquest_pg_9f3a2b7c4d1e';

export const DATABASE_URL =
    process.env['DATABASE_URL'] ??
    `${DATABASE_PROVIDER}://${DATABASE_USERNAME}:${DATABASE_PASSWORD}@${DATABASE_HOST}:${DATABASE_PORT}/${DATABASE_NAME}?schema=public`;

/* ---------------------------------------------------------------------- Auth */

export const BETTER_AUTH_SECRET = process.env['BETTER_AUTH_SECRET'] ?? null;
export const BETTER_AUTH_URL = process.env['BETTER_AUTH_URL'] ?? APP_BASE_URL;

/** Expo deep-link scheme — must match `scheme` in the mobile app's app.json. */
export const EXPO_SCHEME = process.env['EXPO_SCHEME'] ?? 'glowquest';

/**
 * Sign-in with Google (`openid email profile`).
 *
 * Deliberately separate from the Gmail-draft integration (`gmail.compose`), which is
 * requested incrementally the first time a user reaches the "create draft" screen. Do not
 * merge the two: broad scopes at sign-in are a consent-screen tax on every user for a
 * feature most never reach.
 */
export const GOOGLE_OAUTH_CLIENT_ID = process.env['GOOGLE_OAUTH_CLIENT_ID'] ?? null;
export const GOOGLE_OAUTH_CLIENT_SECRET = process.env['GOOGLE_OAUTH_CLIENT_SECRET'] ?? null;
export const GOOGLE_OAUTH_REDIRECT_URI =
    process.env['GOOGLE_OAUTH_REDIRECT_URI'] ?? `${BETTER_AUTH_URL}/api/auth/callback/google`;

/**
 * Google issues a separate OAuth client id per platform (Web, iOS, Android). Expo's native
 * Google Sign-In SDK returns an ID token signed for the iOS/Android client, so the backend
 * must accept all of them when verifying `idToken` sign-ins. Only the ones actually set are used.
 */
export const GOOGLE_CLIENT_IDS = [
    GOOGLE_OAUTH_CLIENT_ID,
    process.env['GOOGLE_OAUTH_CLIENT_ID_IOS'],
    process.env['GOOGLE_OAUTH_CLIENT_ID_ANDROID'],
].filter((id): id is string => Boolean(id));

/* ------------------------------------------------------------------------ AI */

/**
 * Any OpenAI-compatible provider — OpenRouter, OmniRoute, or OpenAI itself. The keys are named
 * after the role, not the vendor, so switching providers is a base URL and a key, never a code
 * change. The base URL must be the root the SDK appends `/chat/completions` to.
 */
export const AI_API_KEY = process.env['AI_API_KEY'] ?? null;
export const AI_BASE_URL = process.env['AI_BASE_URL'] ?? 'https://openrouter.ai/api/v1';

/** Model ids stay in config, never hard-coded in services — the provider layer is swappable. */
export const AI_MODEL_PRIMARY = process.env['AI_MODEL_PRIMARY'] ?? 'anthropic/claude-sonnet-4.5';
export const AI_MODEL_FAST = process.env['AI_MODEL_FAST'] ?? 'anthropic/claude-haiku-4.5';

/** Hard monthly spend ceiling across all users. The cost ledger refuses calls past this. */
export const AI_MONTHLY_COST_CAP_USD = Number(process.env['AI_MONTHLY_COST_CAP_USD'] ?? 200);

/* ------------------------------------------------------------- Object storage */

/**
 * S3-compatible object storage (Cloudflare R2 in production, MinIO in local dev).
 *
 * The bucket is PRIVATE — no public read, no public listing. Every read and write goes
 * through a short-lived presigned URL so a 10 MB PDF never transits this process, and a
 * leaked key is bounded in time. See src/shared/storage/storage.service.ts.
 *
 * CLOUDFLARE_* fallbacks are accepted so an existing R2 credential set drops in unchanged.
 */
export const S3_ENDPOINT =
    process.env['S3_ENDPOINT'] ??
    process.env['CLOUDFLARE_S3_API'] ??
    (process.env['CLOUDFLARE_ACCOUNT_ID']
        ? `https://${process.env['CLOUDFLARE_ACCOUNT_ID']}.r2.cloudflarestorage.com`
        : null);

/** R2 ignores the region but the SDK insists on one; "auto" is R2's documented value. */
export const S3_REGION = process.env['S3_REGION'] ?? 'auto';
export const S3_BUCKET = process.env['S3_BUCKET'] ?? process.env['CLOUDFLARE_BUCKET_NAME'] ?? null;
export const S3_ACCESS_KEY = process.env['S3_ACCESS_KEY'] ?? process.env['CLOUDFLARE_ACCESS_KEY_ID'] ?? null;
export const S3_SECRET_KEY = process.env['S3_SECRET_KEY'] ?? process.env['CLOUDFLARE_SECRET_ACCESS_KEY'] ?? null;

/**
 * Key prefix (folder) inside the bucket. The bucket may be shared across projects, so every
 * object this app writes is namespaced under this prefix. Trailing slashes are stripped so
 * `resolveKey` never produces a double separator.
 */
export const S3_PREFIX = (process.env['S3_PREFIX'] ?? 'glowquest').replace(/\/+$/, '');

/**
 * Public base URL (a custom domain in front of the bucket). Only meaningful for objects that
 * are deliberately public; user content never is, so this stays null in most deployments.
 */
export const S3_PUBLIC_BASE_URL = process.env['S3_PUBLIC_BASE_URL'] ?? null;

/* ------------------------------------------------------------------ Redis */

/**
 * Redis backs three separate concerns on one instance: the BullMQ job queues, the
 * cache-aside layer, and rate-limit buckets. Prefer REDIS_URL; otherwise composed from parts.
 */
export const REDIS_CLIENT = 'REDIS_CLIENT' as const;
export const REDIS_HOST = process.env['REDIS_HOST'] ?? 'localhost';
export const REDIS_PORT = Number(process.env['REDIS_PORT'] ?? 6379);
export const REDIS_PASSWORD = process.env['REDIS_PASSWORD'] ?? undefined;
export const REDIS_USERNAME = process.env['REDIS_USERNAME'] ?? undefined;
export const REDIS_DB = Number(process.env['REDIS_DB'] ?? 0);
export const REDIS_URL =
    process.env['REDIS_URL'] ??
    `redis://${REDIS_USERNAME ? `${REDIS_USERNAME}:${REDIS_PASSWORD ?? ''}@` : REDIS_PASSWORD ? `:${REDIS_PASSWORD}@` : ''}${REDIS_HOST}:${REDIS_PORT}/${REDIS_DB}`;

/** Toggle in-process BullMQ workers. In prod, workers normally run as a dedicated pool. */
export const RUN_WORKERS_IN_PROCESS = (process.env['RUN_WORKERS_IN_PROCESS'] ?? String(!PRODUCTION)) === 'true';

/**
 * Redis lifecycle control — lets an operator start a downed Redis from the API.
 * Off by default: starting a service is a privileged operation and the mechanism is
 * entirely deployment-specific, so it must be opted into explicitly.
 *
 * - `none`    — (default) status only.
 * - `command` — run a local command (`execFile`, no shell). Only works when the API process
 *               shares an OS with Redis: `yarn dev` on the host, or a bare-metal deploy.
 * - `docker`  — drive the Docker Engine API over a bind-mounted `/var/run/docker.sock`.
 *               NOTE: access to that socket is equivalent to root on the host.
 * - `agent`   — call a small single-purpose helper running on the host, which is the only
 *               thing that actually holds the privilege. The right answer when the API is
 *               containerized and Redis is a host systemd service.
 */
const REDIS_CONTROL_DRIVERS = ['none', 'command', 'docker', 'agent'] as const;
export type RedisControlDriverName = (typeof REDIS_CONTROL_DRIVERS)[number];

const _REDIS_CONTROL_DRIVER = process.env['REDIS_CONTROL_DRIVER'] as RedisControlDriverName | undefined;
export const REDIS_CONTROL_DRIVER: RedisControlDriverName =
    _REDIS_CONTROL_DRIVER && REDIS_CONTROL_DRIVERS.includes(_REDIS_CONTROL_DRIVER) ? _REDIS_CONTROL_DRIVER : 'none';

/** Hard ceiling (ms) on any control action. `systemctl start` on a cold Redis is well under this. */
export const REDIS_CONTROL_TIMEOUT = Number(process.env['REDIS_CONTROL_TIMEOUT'] ?? 20_000);

/**
 * Minimum gap (ms) between two control actions. Restarting Redis in a tight loop drops every
 * in-flight BullMQ job, so a double-click must not be able to do it.
 */
export const REDIS_CONTROL_COOLDOWN = Number(process.env['REDIS_CONTROL_COOLDOWN'] ?? 10_000);

/** `command` driver — full command lines, split on whitespace and run without a shell. */
export const REDIS_CONTROL_START_CMD = process.env['REDIS_CONTROL_START_CMD'] ?? 'systemctl start redis-server';
export const REDIS_CONTROL_RESTART_CMD = process.env['REDIS_CONTROL_RESTART_CMD'] ?? 'systemctl restart redis-server';

/** `docker` driver — the bind-mounted Engine socket and the Redis container to act on. */
export const REDIS_CONTROL_DOCKER_SOCKET = process.env['REDIS_CONTROL_DOCKER_SOCKET'] ?? '/var/run/docker.sock';
export const REDIS_CONTROL_DOCKER_CONTAINER = process.env['REDIS_CONTROL_DOCKER_CONTAINER'] ?? 'glowquest-redis';

/** `agent` driver — an http(s) origin or `unix:/path/to.sock`. Token must match the agent's. */
export const REDIS_CONTROL_AGENT_URL = process.env['REDIS_CONTROL_AGENT_URL'] ?? null;
export const REDIS_CONTROL_AGENT_TOKEN = process.env['REDIS_CONTROL_AGENT_TOKEN'] ?? null;

/* ----------------------------------------------------------------- Backups */

/**
 * 32-byte key, base64-encoded, for encrypting backup archives at rest. A backup archive is
 * the user's entire account in one file, so it is encrypted before it ever reaches storage.
 */
export const BACKUP_ENCRYPTION_KEY = process.env['BACKUP_ENCRYPTION_KEY'] ?? null;

/* -------------------------------------------------------------------- Mail */

/**
 * Transactional email (OTP codes, etc.) via SMTP. For Gmail, `MAIL_APP_PASSWORD` is an
 * App Password (not the account password) — generated from the Google Account's
 * "App passwords" settings, which requires 2-Step Verification on the account.
 */
export const MAIL_FROM = process.env['MAIL_FROM'] ?? null;
export const MAIL_APP_PASSWORD = process.env['MAIL_APP_PASSWORD'] ?? null;

Color.line('', '-------------------------------------- ' + NODE_ENV + ' --------------------------------------', '');
