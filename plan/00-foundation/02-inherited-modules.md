# 00.2 · Inherited modules — the contract

**Goal:** state precisely what already exists, so no feature plan re-specifies it and no
feature plan assumes something that is not there.

Every plan in `plan/` is written against this contract. If something is listed here, build
on it rather than reinventing it. If something you need is *not* listed here, it does not
exist yet and its plan has to say so.

## Auth — `src/auth/`

`src/auth/auth.ts` builds the Better Auth instance at module load. It provides:

- **Email + password**, min length 8.
- **Email OTP** — `POST /api/auth/email-otp/send-verification-otp` then
  `POST /api/auth/sign-in/email-otp`. 6 digits, 300s expiry, 5 attempts. A first-time email
  auto-creates the account, which is exactly what `mobile-app/src/app/email.tsx` →
  `otp.tsx` expects.
- **Google**, with a `clientId` **array** so native iOS/Android ID tokens verify alongside
  the web client. Account linking is on, with `google` trusted.
- **Expo plugin** + **bearer plugin**. The app authenticates with
  `Authorization: Bearer <token>`; the token comes back in the `set-auth-token` response
  header, which is CORS-exposed in `main.ts`.
- **`user.create.before`** forces `role: USER`. **`user.create.after`** upserts `UserMeta`.
  Both are extension points this plan uses.
- **`session.create.before`** blocks sessions for `isActive: false` or soft-deleted users.
  This is the single login gate — no feature module needs its own active-user check.

Default-deny is in force: every route requires a session unless it carries
`@AllowAnonymous()`. The adapter's opt-out shape is class-level `@AllowAnonymous()` plus
per-route `@SetMetadata('PUBLIC', false)` — see `src/auth/auth.controller.ts`.

**Not present:** anonymous sign-in. Added in [01-identity/01](../01-identity/01-anonymous-accounts.md).

## Response envelopes — `src/common/`

- `GlobalSuccessInterceptor` wraps `POST`/`PUT`/`PATCH`/`DELETE` responses as
  `{ message, localeKey, status, data }`. Annotate with `@ApiSuccessMeta({ message, localeKey })`.
  `GET` responses are returned bare.
- `GlobalExceptionFilter` renders every failure as
  `{ message, statusCode, code, status, errors, requestId }` — never a bare string, never
  HTML, including 500s.
- `ApiException` is the throw type. It takes `{ statusCode, message, code, localeKey, status?, errors?, meta? }`.
- `ValidationPipe` runs `whitelist` + `forbidNonWhitelisted`, so an unexpected body field is
  a 400, not a silent drop.

Every error `code` this plan introduces is listed in
[99-appendix/01-api-reference.md](../99-appendix/01-api-reference.md#error-codes).

## Database — `src/prisma/`

`PrismaService` is `@Global`. Prisma 7 with `@prisma/adapter-pg`, client generated into
`src/generated/prisma`, `moduleFormat: cjs`. Conventions the schema already follows and
this plan continues:

- **UUIDv7** primary keys (`@default(uuid(7)) @db.Uuid`) on everything we own. Better Auth's
  four tables are the exception — the library mints its own ids.
- `snake_case` table names via `@@map`, camelCase in the client.
- **Every user-owned row cascades from `User`**, so account deletion stays a single
  `DELETE`. Any new table in this plan that hangs off a user must keep that property.

`prisma/sql/00-extensions.sql` installs `pgvector` and `pg_trgm`. `pgvector` is now unused
(see [01-domain-realignment](01-domain-realignment.md)); `pg_trgm` stays for player-name
search on leaderboards.

## Pagination — `src/common/cursor.util.ts`

Keyset pagination, ready to use: `encodeCursor`, `decodeCursor`, `cursorWhere`,
`cursorOrderBy`, `cursorLimit` (default 15, hard cap 50), `toCursorPage`. `cursorWhere`
supports `kind: 'number'` for `Int` sort columns, which is what leaderboard ranking needs.

The cursor is opaque to clients. Tampering raises `INVALID_CURSOR` (400).

Note the docblock references `docs/FEED-API.md`, which does not exist in this repo. Fix the
reference during phase 00.

## Cache — `src/shared/redis/`

`RedisService` gives cache-aside `getOrSet(keys, fn, { ttl })` with in-process in-flight
deduplication, plus `withPrefix()` / `withTtl()` / `withTtlMin()` scoped clones that share
one connection. `.client` exposes the raw `ioredis` instance — which is what the
leaderboard needs for `ZADD`/`ZREVRANGE`.

`RedisStatusService` probes health; `redis-control/` can start a downed Redis via a
configurable driver. Neither is needed by feature code.

## Queues — `src/shared/queue/`

BullMQ on the same Redis. `QueueService` enqueues; `BaseWorker` is the worker base class
with dead-lettering to `<queue>.dead`. `RUN_WORKERS_IN_PROCESS` controls whether workers run
inside the API process — it must be `true` for the current single-container deploy.

Queue names are replaced wholesale in phase 00.

## Storage — `src/shared/storage/`

S3-compatible client with presign, HEAD and prefix sweep. Private bucket; every read is a
5-minute presigned URL logged to `file_access_logs`. `src/common/upload/` holds multer
profiles and limits, with `assertConfig()` cross-checking them against the proxy body limit
at boot.

**Unused by v1.** Kept intact for deferred avatar upload.

## Logging and audit — `src/common/logging/`, `src/modules/admin/audit/`

Three Express-level middlewares, mounted ahead of Better Auth's router: request-id →
access log → auth audit. `AuditService` is `@Global`; this plan uses it for economy
mutations, shop purchases and guest merges.

`AuditLog.actorId` is deliberately FK-free and `actorEmail` is denormalized, so history
survives the actor. Keep both properties when writing game audit rows.

## Mail — `src/shared/mail/`

`sendOtpEmail(email, otp, type, minutes)` over SMTP, with an HTML template. Wired into the
Better Auth `emailOTP` plugin and the account-deletion flow. No other transactional mail
exists; daily-reminder notifications are **device-local** in the mobile app
(`mobile-app/src/reminder/`) and stay that way in v1.

## Deploy — `.github/workflows/docker-deploy.yml`

verify → build-and-push (GHCR, `:latest` + `:<sha>`) → deploy over SSH with
`prisma migrate deploy` as an explicit step, then a healthcheck wait. Deploy is opt-in via
the `DEPLOY_ENABLED` variable.

Migrations never run at boot. Any plan that needs a data backfill must ship it as a
migration or a one-shot script under `scripts/`, not as an `onModuleInit`.

## Testing

`yarn test` is Jest unit tests (`src/**/*.spec.ts`). `yarn test:e2e` runs **against a live
server** over HTTP — not an in-process Nest fixture, because Better Auth and its Nest
adapter are ESM-only and this app compiles to CommonJS. Every e2e test in this plan is
written for that shape.
