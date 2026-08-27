# base-app Backend

NestJS API for the base-app AI Career OS mobile app.

This repository currently contains the **foundation** — auth, database, config, storage,
queues, cache, logging and the deploy pipeline. Feature modules are specified in
[`claude-plans/`](claude-plans/README.md) and are built on top of what is here. The
infrastructure layer is ported from an existing production backend rather than designed
fresh; `claude-plans/00-foundation/02-inherited-modules.md` is the contract every feature
plan assumes, and this codebase satisfies it.

## Stack

| Concern        | Choice                                                                |
| -------------- | --------------------------------------------------------------------- |
| Framework      | NestJS 11, TypeScript 5.7                                             |
| ORM            | Prisma 7 (`prisma-client` generator, `@prisma/adapter-pg`)            |
| Database       | PostgreSQL + `pgvector` + `pg_trgm`                                   |
| Auth           | Better Auth (email/password, email OTP, Google, Expo)                 |
| Queue          | BullMQ on Redis                                                       |
| Cache          | Redis (cache-aside, in-flight dedupe)                                 |
| Object storage | S3-compatible (Cloudflare R2 / MinIO), private bucket, presigned URLs |
| LLM            | Anthropic, provider-abstracted, with a cost ledger                    |
| API docs       | `@nestjs/swagger` at `/docs`                                          |
| Admin console  | Vite + React 19, Ant Design 6 (Tailwind 4 for layout, no Preflight)   |

## Getting started

```bash
yarn install

cp .env.example .env          # fill in the blanks — see "Environment" below
sudo -u postgres psql -f scripts/db-bootstrap.sql   # role, database, extensions (once)

yarn install
yarn install:web              # the admin console has its own dependency tree

yarn db:push                  # apply schema + generate client + apply prisma/sql/*.sql
yarn dev                      # API + admin console together
```

The API prints a startup banner with its URL, the health endpoint, the docs path, the admin
console and whether the database is reachable.

### Scripts

| Command                              | What it does                                                    |
| ------------------------------------ | --------------------------------------------------------------- |
| `yarn dev`                           | Watch-mode API **and** the console's Vite server, together      |
| `yarn dev:api` / `yarn dev:web`      | One half at a time                                              |
| `yarn build`                         | `build:api` then `build:web`                                    |
| `yarn build:api`                     | Clean build, then rewrite `@/*` aliases with `tsc-alias`        |
| `yarn build:web`                     | Type-check and bundle the console into `web/dist`               |
| `yarn install:web`                   | Install the console's dependencies                              |
| `yarn lint`                          | ESLint with `--fix`                                             |
| `yarn test`                          | Unit tests                                                      |
| `yarn test:e2e`                      | End-to-end tests **against a running server** (see below)       |
| `yarn db:push`                       | `prisma db push` → `prisma generate` → apply `prisma/sql/*.sql` |
| `yarn db:migrate` / `yarn db:deploy` | Migration workflow for staging and production                   |
| `yarn db:backup`                     | Timestamped `pg_dump` (custom format) into `backups/`           |
| `yarn db:studio`                     | Prisma Studio                                                   |

## Architecture

```
src/
  main.ts              bootstrap: config assertion, CORS, pipes, filters, timeouts, Swagger
  app.module.ts        module graph — import ORDER is load bearing, see the comment there
  config/              typed env reads, boot-time validation
  auth/                Better Auth instance, roles, registration, settings, account deletion
  prisma/              PrismaService (global)
  common/
    errors/            ApiException + the error envelope types
    filters/           global exception filter
    interceptors/      global success envelope
    logging/           request-id → access log → auth audit (Express level)
    middleware/        reshapes Better Auth's own error responses into our envelope
    pipes/             validation pipe (whitelist + forbidNonWhitelisted)
    upload/            multer profiles, limits, error mapping
    http/              Node server timeouts
    cursor.util.ts     keyset pagination
    prisma-query-builder.service.ts
  modules/admin/audit/ audit trail (global service + admin endpoints)
  web/                 admin console plumbing — reserved paths, admin gate, proxy, static
  shared/
    storage/           S3 client, presign, HEAD, prefix sweep
    redis/             client, cache-aside service, status probe, lifecycle control
    queue/             BullMQ queues, BaseWorker, dead-lettering
    telemetry/         model-call ledger and spend accounting
    mail/              SMTP sender + OTP template
    dto/               shared query DTOs
  helper/              Aide, Color, LogFile, Slug
```

### Request lifecycle

```
HTTP → requestId → access log → auth audit → CORS
     → Better Auth (session)  → ValidationPipe
     → Controller → Service → Prisma / Queue / Storage / AI
     → GlobalSuccessInterceptor → GlobalExceptionFilter
```

### Response envelope

Mutating requests (`POST`/`PUT`/`PATCH`/`DELETE`) are wrapped by the success interceptor:

```jsonc
{ "message": "Settings saved successfully", "localeKey": "updated.auth.settings", "status": "normal", "data": {} }
```

Errors are always this shape, never a bare string, never HTML — even for a 500:

```jsonc
{
    "message": "An account with this email already exists.",
    "statusCode": 409,
    "code": "USER_ALREADY_EXISTS",
    "status": "warn",
    "errors": null,
    "requestId": "5e19bd24-…",
}
```

The client switches on `code`, never on `message`. `requestId` matches the `x-request-id`
response header and the access log line, so a user-reported failure is one grep away.

## Auth

Better Auth mounts its own router at `/api/auth/*` (sign-in, sign-out, session, OTP, Google).
Everything alongside it lives at `/v1/auth`:

| Route                                      | Purpose                                               |
| ------------------------------------------ | ----------------------------------------------------- |
| `POST /v1/auth/register`                   | Register with this API's error envelope, and audited  |
| `GET /v1/auth/me`                          | Current user + settings, read fresh from the database |
| `GET` / `PUT /v1/auth/me/settings`         | Theme, locale, timezone, page size, email preferences |
| `POST /v1/auth/account/delete/request-otp` | Email a confirmation code                             |
| `POST /v1/auth/account/delete/confirm`     | Irreversible: audit snapshot → storage sweep → row    |

Default-deny: every route requires a session except `/health` and registration.
`role` is `input: false` on the Better Auth user model, so a client cannot set it; sending it
anyway is a `400`, not a silent drop.

## Admin console

A Vite + React SPA in `web/`, served by this same process at `/admin`. Co-hosted rather
than deployed separately so it is same-origin: the Better Auth session cookie authenticates
it with no CORS relaxation and no second credential.

| Mode                   | How `/admin` is served                                         |
| ---------------------- | -------------------------------------------------------------- |
| `NODE_ENV=development` | Reverse-proxied to the Vite dev server, HMR websocket included |
| anything else          | `web/dist` as static files, with SPA history fallback          |

`/admin/login` is public — that is the sign-in screen, a React route, so the JavaScript
needed to boot it is served without a session. Every other `/admin` navigation requires an
`ADMIN` session: an anonymous visitor is redirected to `/admin/login`, and a signed-in
non-admin gets a small server-rendered refusal (`src/web/login-page.ts`). Dashboard routes
are also gated in the client (`beforeLoad` on the authenticated layout) so a client-side
transition cannot skip the check.

### Routes never collide

The console lives under `/admin`, so `/v1` and `/health` are ordinary Nest routes. The gate
still `next()`s the API prefixes first — `RESERVED_API_PREFIXES` in
`src/web/reserved-paths.ts` — because it is registered as process-wide middleware:

```
/v1        every Nest controller          /health    liveness probe
/api       Better Auth's router           /docs      Swagger (+ -json, -yaml)
/admin     this console
```

New endpoints go under `/v1` and nothing changes. A new **top-level** API path must be added
to that list in the same commit that registers it. `src/web/reserved-paths.spec.ts` pins the
boundary, including near-misses like `/v1analytics` and `/apikeys`.

Console routes are files under `web/src/routes/` (TanStack Router). `/login` is public;
everything else sits under the `_authenticated` layout and requires an admin session. The
history fallback already serves the shell for any unmatched `/admin` path.

### UI: Ant Design first, Tailwind for layout

**Ant Design owns the components.** Tailwind is present for layout and spacing, and is
deliberately kept out of the design system's way — its Preflight reset is _not_ imported,
because Preflight unsets borders, heading sizes and form-control appearance globally and
quietly strips things antd expects. antd's own reset (`antd/dist/reset.css`) takes the slot
Preflight would have occupied.

The cascade is arranged so that antd wins any genuine conflict. Unlayered CSS beats layered
CSS regardless of specificity, which gives, weakest to strongest:

```
@layer theme       Tailwind tokens
@layer base        antd's reset      ← a utility may override this, as with any reset
@layer utilities   Tailwind utilities
(unlayered)        antd components, injected at runtime by its CSS-in-JS
```

Two consequences follow, both intended:

- **A utility cannot restyle an antd component.** `<Layout className="min-h-screen">` does
  nothing, because `.ant-layout` sets its own `min-height`. Style antd components through
  antd — props, `style`, and `theme.useToken()` — and save utilities for plain elements.
  Never pass `layer` to `ConfigProvider`; it moves antd into `@layer antd` and inverts all
  of the above.
- **Bare `border` renders nothing**, since Preflight's global `border-style: solid` is gone.
  Write `border border-solid`.

Theme lives in `web/src/theme.ts` — thin on purpose, since the dark algorithm's defaults are
the design. The remaining server-rendered surface is the "not an admin" refusal, which
hard-codes the same tokens; `src/web/login-page.ts` and `web/src/theme.ts` have to change
together or that page stops matching the console.

### Configuration

`WEB_ENABLED` (default on), `WEB_DEV_SERVER_URL` (default `http://localhost:5273` — not
Vite's 5173, which collides with any other Vite project on the machine), and `WEB_DIST_DIR`
(default `web/dist`). The dev port is pinned with `strictPort` in `web/vite.config.ts`, so it
and `WEB_DEV_SERVER_URL` must change together.

## Uploads

The primary path is a **presigned direct PUT to S3** — the bytes never transit this process,
which is also what lets the client render an honest progress bar. Multipart through the API
exists as a fallback for environments where a direct PUT is blocked.

Every limit in the app lives in `src/common/upload/upload-limits.ts`; no route declares its
own numbers. `assertConfig()` cross-checks each profile against the reverse proxy's body
limit at boot, because a profile that exceeds it fails as an unexplained 413 with no app log.

A client-declared MIME type is treated as a claim, not evidence: the `complete` step re-reads
the first bytes of the stored object and sniffs them before a file is ever marked `READY`.

## Storage layout

```
users/{userId}/uploads/{fileId}/{originalName}
users/{userId}/renders/{fileId}.pdf
users/{userId}/backups/{backupId}.base-app-backup
users/{userId}/exports/{exportId}.zip
```

Prefix-per-user, so deleting an account is a single prefix sweep rather than a join across
every table that might hold a file reference. The bucket is private; every read is a
five-minute presigned URL, and each issued URL is written to `file_access_logs`.

## Logging and audit

Three layers, all mounted at the Express level so Better Auth's own routes are included:

1. **Request id** — generated, or an inbound `x-request-id` echoed after validation.
2. **Access log** — one line per request. Aborted requests are logged too (the `close` event,
   not just `finish`), which is how an abandoned upload becomes visible instead of vanishing.
3. **Auth audit** — a row in `audit_logs` for every sign-in, sign-up and sign-out, success or
   failure. Registration through `/v1/auth/register` is audited in the service, because it
   calls Better Auth in-process and never crosses the HTTP layer the middleware watches.

Disable the access log with `HTTP_LOG=false`; strip colours with `NO_COLOR=1`.

## Environment

Every key is documented in [`.env.example`](.env.example) and validated at boot by
`src/config/validate.ts`. In production a missing or malformed key is fatal; in development it
warns and the affected integration degrades, so local work without every credential still runs.

## Testing

`yarn test` runs the unit suites. `yarn test:e2e` runs against a **live server**:

```bash
yarn dev            # terminal 1
yarn test:e2e       # terminal 2  (override the target with E2E_BASE_URL)
```

It is not the usual in-process Nest fixture, and cannot be: Better Auth and its Nest adapter
ship ESM only, this app compiles to CommonJS, and Jest's CJS runtime has no equivalent of
Node's `require(esm)`. Testing over HTTP is the better shape regardless — it exercises the
real bootstrap, including the middleware chain and Better Auth's mounted router.

## Deployment

Push to `main` triggers `.github/workflows/docker-deploy.yml`:

1. **verify** — install, generate the Prisma client, lint, test, build. The image is not
   built from code that does not compile.
2. **build-and-push** — multi-stage Docker build to `ghcr.io/syedamirali/base-app-backend`,
   tagged `:latest` and `:<sha>` so a rollback needs no rebuild.
3. **deploy** — over SSH: pull (with retries, GHCR 503s are common), run
   `prisma migrate deploy`, recreate the container, then **wait for the healthcheck** before
   declaring success.

Migrations run as an explicit deploy step, never at app boot — several containers starting at
once would race the same migration, and a failed one would crash-loop the API instead of
failing one visible step.

`docker-compose.yml` is safe to commit: every value comes from the `.env` beside it. Only the
two values that genuinely differ inside a container are set in the file — `DATABASE_HOST` and
`REDIS_HOST` point at `host.docker.internal`, because Postgres and Redis run on the host and
`localhost` inside a container is the container.

The deploy job is opt-in, so the pipeline is not permanently red before a server exists.
`verify` and `build-and-push` run on every push regardless — the image lands in GHCR either
way, so a manual `docker compose pull && docker compose up -d` on the server always works.

To enable automatic deploys:

```bash
gh secret set SSH_HOST && gh secret set SSH_USER && gh secret set SSH_PRIVATE_KEY
gh secret set SSH_PORT            # only if not 22
gh variable set DEPLOY_ENABLED --body true
```
