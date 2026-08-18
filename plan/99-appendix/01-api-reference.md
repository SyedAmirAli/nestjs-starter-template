# A1 · API reference

Every endpoint in this plan. Request and response shapes live in the linked phase docs; this
is the map.

**Base:** `/v1`. Better Auth keeps its own router at `/api/auth/*`.
**Auth column:** `public` · `any` (any session, including anonymous) · `named` (non-anonymous) · `admin`.

## Auth — Better Auth's own router

| Method | Path                                          | Auth   | Notes                                     |
| ------ | --------------------------------------------- | ------ | ----------------------------------------- |
| `POST` | `/api/auth/sign-in/anonymous`                 | public | **New.** Device account. [01.1](../01-identity/01-anonymous-accounts.md) |
| `POST` | `/api/auth/email-otp/send-verification-otp`   | public | Existing                                  |
| `POST` | `/api/auth/sign-in/email-otp`                 | public | Existing                                  |
| `POST` | `/api/auth/sign-in/email`                     | public | Existing                                  |
| `POST` | `/api/auth/sign-in/social`                    | public | Google. Existing                          |
| `POST` | `/api/auth/sign-out`                          | any    | Existing                                  |
| `GET`  | `/api/auth/get-session`                       | any    | Existing                                  |

## Auth — this API

| Method | Path                                       | Auth  | Notes                                    |
| ------ | ------------------------------------------ | ----- | ---------------------------------------- |
| `POST` | `/v1/auth/register`                        | public| Existing                                 |
| `GET`  | `/v1/auth/me`                              | any   | Existing; **gains `isAnonymous`**        |
| `GET`  | `/v1/auth/me/settings`                     | any   | Existing                                 |
| `PUT`  | `/v1/auth/me/settings`                     | any   | Existing; `timezone` is now load-bearing |
| `POST` | `/v1/auth/account/delete/request-otp`      | named | Existing                                 |
| `POST` | `/v1/auth/account/delete/confirm`          | named | Existing                                 |

## Players

| Method  | Path                              | Auth   | Notes                                       |
| ------- | --------------------------------- | ------ | ------------------------------------------- |
| `GET`   | `/v1/players/me`                  | any    | Profile + level + XP + eligibility          |
| `PATCH` | `/v1/players/me`                  | any    | Partial. Country limited to 1 change/30 days|
| `POST`  | `/v1/players/me/onboarding-complete` | any | Idempotent                                  |
| `GET`   | `/v1/players/me/merge-status`     | any    | Guest→member merge state                    |
| `GET`   | `/v1/reference`                   | public | Countries, languages, age bands, interests  |

## Levels

| Method | Path                                       | Auth   | Notes                                  |
| ------ | ------------------------------------------ | ------ | -------------------------------------- |
| `GET`  | `/v1/levels/manifest`                      | public | ETag; the foreground poll              |
| `GET`  | `/v1/levels?since=&limit=&cursor=`         | public | Revision delta + tombstones            |
| `GET`  | `/v1/levels/:number`                       | public | One level                              |
| `GET`  | `/v1/admin/levels`                         | admin  | Draft-aware listing                    |
| `POST` | `/v1/admin/levels`                         | admin  | Create draft                           |
| `PATCH`| `/v1/admin/levels/:id`                     | admin  | Edit draft                             |
| `POST` | `/v1/admin/levels/publish`                 | admin  | Transactional revision bump            |

## Runs and progress

| Method   | Path                                     | Auth | Notes                                        |
| -------- | ---------------------------------------- | ---- | -------------------------------------------- |
| `POST`   | `/v1/runs`                               | any  | **The core endpoint.** Idempotent on `clientRunId` |
| `GET`    | `/v1/runs?cursor=&limit=`                | any  | Run history                                  |
| `GET`    | `/v1/runs/saved`                         | any  | All saved boards                             |
| `PUT`    | `/v1/runs/saved/:levelNumber/:mode`      | any  | Upsert a board                               |
| `DELETE` | `/v1/runs/saved/:levelNumber/:mode`      | any  | Clear a board                                |
| `GET`    | `/v1/progress?since=&cursor=`            | any  | Wallet + tracks + per-level + streak         |
| `POST`   | `/v1/progress/sync`                      | any  | Batch of ≤100 queued runs                    |

## Economy and shop

| Method  | Path                                        | Auth  | Notes                             |
| ------- | ------------------------------------------- | ----- | --------------------------------- |
| `GET`   | `/v1/economy/wallet`                        | any   | `no-store`                        |
| `GET`   | `/v1/economy/ledger?currency=&cursor=`      | any   | Currency history                  |
| `POST`  | `/v1/admin/economy/adjust`                  | admin | Audited; reason mandatory         |
| `GET`   | `/v1/shop/catalog`                          | any   | Includes per-player affordability |
| `POST`  | `/v1/shop/purchase`                         | any   | `Idempotency-Key` required        |
| `GET`   | `/v1/shop/purchases?cursor=`                | any   | History                           |
| `POST`  | `/v1/admin/shop/items`                      | admin | Create                            |
| `PATCH` | `/v1/admin/shop/items/:id`                  | admin | Update / retire                   |

## Retention

| Method  | Path                        | Auth | Notes                                    |
| ------- | --------------------------- | ---- | ---------------------------------------- |
| `GET`   | `/v1/streak`                | any  | Streak, freezes, today, `last14Days`     |
| `GET`   | `/v1/streak/weekly`         | any  | Seven-bar XP chart                       |
| `PATCH` | `/v1/streak/goal`           | any  | `dailyGoalMinutes`, 5–120                |
| `GET`   | `/v1/quests`                | any  | Today's three; rolls lazily if needed    |
| `POST`  | `/v1/quests/:id/claim`      | any  | `Idempotency-Key` required               |

## Leaderboards

| Method | Path                                                        | Auth | Notes                          |
| ------ | ----------------------------------------------------------- | ---- | ------------------------------ |
| `GET`  | `/v1/leaderboard?scope=&period=&country=&limit=&cursor=`    | any  | Podium + rows + `you`          |
| `GET`  | `/v1/leaderboard/me`                                        | any  | Just `you`; uncached           |
| `GET`  | `/v1/leaderboard/countries`                                 | any  | Countries by aggregate score   |

## Admin and ops

| Method | Path                                    | Auth   | Notes                          |
| ------ | --------------------------------------- | ------ | ------------------------------ |
| `GET`  | `/health`                               | public | Existing                       |
| `GET`  | `/docs`                                 | public\* | Swagger; off in prod by default |
| `GET`  | `/v1/admin/jobs/status`                 | admin  | Queue depths, last runs        |
| `GET`  | `/v1/admin/metrics`                     | admin  | Mismatch rate, drift, rejections |
| `GET`  | `/v1/admin/integrity/flagged?cursor=`   | admin  | Flagged players                |
| `PATCH`| `/v1/admin/integrity/:userId`           | admin  | Set state + reason; audited    |
| `POST` | `/v1/admin/runs/:id/reverse`            | admin  | Reverse a run's rewards; audited |
| `GET`  | `/v1/admin/audit?cursor=`               | admin  | Existing                       |

## Headers

| Header                       | Direction | Purpose                                                     |
| ---------------------------- | --------- | ----------------------------------------------------------- |
| `Authorization: Bearer <t>`  | →         | Session token from `set-auth-token`                          |
| `Idempotency-Key`            | →         | UUIDv7 on purchases and quest claims                         |
| `If-None-Match`              | →         | Level manifest and reference data                            |
| `X-App-Version`              | →         | Semver; logged, and the axis mismatch metrics are cut by     |
| `X-Platform`                 | →         | `ios` \| `android` \| `web`                                  |
| `X-Client-Predicted-Score`   | →         | Advisory only. Never stored as a value; drives drift alerting |
| `X-Request-Id`               | ↔         | Echoed after validation; matches the access log               |
| `set-auth-token`             | ←         | Better Auth session token (CORS-exposed)                      |
| `ETag`                       | ←         | Level manifest, delta, reference data                         |
| `Retry-After`                | ←         | On 429                                                        |

## Error codes

Existing envelope (`src/common/errors/`). Clients switch on `code`.

| Code                        | Status | Where                                              |
| --------------------------- | ------ | -------------------------------------------------- |
| `VALIDATION_FAILED`         | 400    | Any DTO failure; `errors` carries the field map     |
| `INVALID_CURSOR`            | 400    | Existing, `cursor.util.ts`                          |
| `UNAUTHORIZED`              | 401    | No/expired session                                  |
| `USER_DEACTIVATED`          | 403    | Existing, Better Auth session gate                  |
| `FORBIDDEN`                 | 403    | Role or ownership                                   |
| `LEVEL_NOT_FOUND`           | 404    | Run submission, saved runs                          |
| `SHOP_ITEM_UNAVAILABLE`     | 404    | Inactive or out of window                           |
| `QUEST_NOT_FOUND`           | 404    | Claim                                               |
| `SAVED_RUN_STALE`           | 410    | `packRevision` mismatch                             |
| `PURCHASE_LIMIT_REACHED`    | 409    | Per-player lifetime cap                             |
| `QUEST_NOT_COMPLETE`        | 409    | Claim before target                                 |
| `COUNTRY_CHANGE_TOO_SOON`   | 429    | 30-day cooldown                                     |
| `INSUFFICIENT_POINTS`       | 402    | `meta: { required, available }`                     |
| `BATCH_TOO_LARGE`           | 413    | > 100 runs in one sync                              |
| `RUN_IMPLAUSIBLE`           | 422    | Hard validation failure                             |
| `DISPLAY_NAME_INVALID`      | 422    | Length, charset or screening                        |
| `COUNTRY_UNSUPPORTED`       | 422    | Not in the published list                           |
| `LANGUAGE_UNSUPPORTED`      | 422    | Not in the published list                           |
| `INTEREST_UNSUPPORTED`      | 422    | Not in the published list                           |
| `RATE_LIMITED`              | 429    | With `Retry-After`                                  |
| `INTERNAL_ERROR`            | 500    | Existing catch-all; still the standard envelope     |
