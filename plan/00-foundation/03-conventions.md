# 00.3 · Conventions for every game endpoint

Decisions made once here so no feature plan has to make them again.

## Route shape

```
/v1/<resource>[/<sub>]
```

Better Auth owns `/api/auth/*`. Everything else is `/v1/*` — matching the existing
`@Controller('auth')` → `/v1/auth`. There is no `/api/v1` prefix.

## Versioning

`/v1` is the only version. Additive changes (a new optional field, a new endpoint) ship
inside `v1`. A breaking change ships as `/v2` alongside it, because a mobile app on the
store cannot be forced to update.

Every client sends `X-App-Version` (semver) and `X-Platform` (`ios` | `android` | `web`).
Both are logged with the access line and are what make "this only breaks on 1.2.0" a
one-grep question rather than an investigation.

## Idempotency

Any mutation that moves the economy takes a client-generated key:

- Run submission: `clientRunId` (UUIDv7, in the body).
- Shop purchase, quest claim: `Idempotency-Key` header (UUIDv7).

Uniqueness is `@@unique([userId, clientRunId])` — per user, not global, so one device's
UUID collision can never reach another player's data. A replay returns **the original
result with 200**, not a 409. The client cannot distinguish "my retry succeeded" from "my
first attempt succeeded", which is the entire point: a flaky connection must never cost or
double-pay a player.

Keys are retained 30 days, then swept by the housekeeping job.

## Time

- Every timestamp on the wire is **ISO 8601 UTC with `Z`**. No local times, ever.
- Durations are **milliseconds, integer** (`elapsedMs`). The mobile app currently counts in
  whole seconds (`useBoard.ts` ticks a 1s interval); milliseconds on the wire costs nothing
  now and avoids a breaking change if the client ever gains a finer timer.
- "Which day did this happen on" is resolved against the player's **IANA timezone** from
  `UserMeta.timezone`, falling back to `UTC`. That single rule is what makes streaks
  correct for a player in Dhaka; it is specified in detail in
  [05-retention/01](../05-retention/01-streaks.md).

## Money-like integers

Score, XP and points are **integers**. There are no fractional currencies anywhere in this
system, and none may be introduced — a float balance drifts the first time a job retries.

## Pagination

Cursor pagination via `src/common/cursor.util.ts` for anything that grows: leaderboards,
run history, ledger reads. Level content uses a revision-based delta instead (see
[02-content/01](../02-content/01-level-pack-sync.md)) because it is a set to reconcile, not
a feed to scroll.

Never offset pagination on a leaderboard. Ranks shift between requests; `?page=2` would
serve duplicates and holes.

## Caching and conditional requests

- Level content: `RedisService.getOrSet`, TTL 1 hour, plus a strong `ETag` derived from the
  pack revision. A client that already has the current revision gets a `304` and no body.
- Leaderboards: Redis sorted sets are the read path. TTL 60s on the rendered page.
- Anything user-specific: `Cache-Control: private, no-store`. Never cache a wallet.

## Rate limits

Per user (or per device for anonymous), enforced in Redis with a fixed window:

| Endpoint group      | Limit               | Rationale                                                        |
| ------------------- | ------------------- | ---------------------------------------------------------------- |
| `POST /v1/runs`     | 60 / 5 min          | Comfortably above the fastest honest play; well below a script.  |
| `POST /v1/progress/sync` | 12 / hour      | A batch endpoint. Twelve full syncs an hour is already generous. |
| `POST /v1/shop/purchase` | 30 / hour      | Purchases are deliberate acts.                                   |
| Level + leaderboard reads | 300 / 5 min   | Cheap and cached; the limit exists to stop scraping, not users.  |

Exceeding a limit is `429` with `code: RATE_LIMITED` and a `Retry-After` header.

## Anonymous access

| Access                | Endpoints                                                        |
| --------------------- | ---------------------------------------------------------------- |
| **Public**            | `GET /health`, `GET /v1/levels/*`, `POST /v1/auth/register`      |
| **Any session** (incl. anonymous) | everything else in this plan                          |
| **Named account only**| `PUT /v1/players/me/country`, appearing on leaderboards, referrals |

An anonymous player can play, sync, earn and *view* leaderboards. They do not appear on one
— see [06-leaderboards/01](../06-leaderboards/01-leaderboards.md) for why, and for how the
app communicates it.

## DTOs and validation

`class-validator` + `class-transformer`, one DTO file per operation under the module's
`dto/`, mirroring `src/auth/dto/`. Because `forbidNonWhitelisted` is on globally, a DTO is
also the allow-list — a field absent from the DTO is a 400.

Server-managed fields are absent from DTOs **by construction**, the way
`UserRegistryService.toWritable` does it. That is what keeps a future column from becoming
client-writable the day it is added.

Distinguish absent from cleared the same way `toWritable` does: `if (dto.x !== undefined)`,
with `''` normalising to `null`.

## Swagger

Every controller carries `@ApiTags`, every route `@ApiOperation`, every mutation
`@ApiSuccessMeta`, and every documented failure `@ApiError`. `/docs` stays off in
production unless `SWAGGER_ENABLED=true`.

## Naming

- Tables: `snake_case` plural (`level_progress`, `power_ledger`).
- Enums: `SCREAMING_SNAKE` members.
- The two game tracks are `WORD` and `SENTENCE` in an enum named `GameMode`, matching the
  client's `'word' | 'sentence'`. Serialize them **lowercase** on the wire so the mobile
  app's existing `GameMode` type needs no mapping layer.
