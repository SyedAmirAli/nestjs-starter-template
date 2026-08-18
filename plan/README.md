# GlowQuest Backend — Plan

Everything the API has to become, in the order it should be built.

GlowQuest is a casual word-puzzle game for Bengali speakers learning English. Two
independent level tracks (**Word** and **Sentence**), a serpentine level map, a
score/stars/Powers economy, streaks, and country + global leaderboards. The mobile app
(`../mobile-app`) already ships all 26 screens and plays **fully offline** against a
bundled 50-level pack seeded into on-device SQLite.

That last fact is the single most important constraint in this plan. The backend is not
being added underneath an app that is waiting for it — it is being added underneath an app
that already works without it. So every endpoint here is designed as **sync, not
dependency**: the game must remain playable end-to-end with the network off, and the
server's job is to be the durable, authoritative, shared copy of what the device already
knows.

## The four decisions this plan is built on

| Decision                | Choice                                                                                                                                            |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Guests**              | Real anonymous accounts, issued per device, merged into a real account on sign-up. Guests get leaderboards and cloud sync from their first launch. |
| **Scoring authority**   | The server recomputes stars, score, XP and Powers from raw run facts. A client-sent score is a prediction, never a value we store.                 |
| **Inherited foundation**| Keep the plumbing, strip the wrong domain. This repo's infra was ported from an unrelated product ("AI Career OS") and still carries its schema.   |
| **v1 scope**            | Core (auth, levels, runs, progress, leaderboards) + Economy (XP, points, Powers, shop) + Retention (streaks, freezes, daily goal, quests).          |

Achievements, milestones as first-class records, referrals, avatar upload and additional
learning languages are **out of v1** and specified in [`99-appendix/04-deferred.md`](99-appendix/04-deferred.md)
so the v1 schema does not have to be reopened to add them.

## Phases

Build them in this order. Each phase leaves the API in a shippable state, and each depends
only on the phases above it.

| Phase                                       | What it delivers                                                              | Depends on |
| ------------------------------------------- | ----------------------------------------------------------------------------- | ---------- |
| **[00 · Foundation](00-foundation/)**       | Retarget the inherited repo to the game domain; lock conventions.             | —          |
| **[01 · Identity](01-identity/)**           | Anonymous device accounts, guest→member merge, player profile.                | 00         |
| **[02 · Content](02-content/)**             | The level pack as server-owned content, with revisioned delta sync.           | 00         |
| **[03 · Gameplay](03-gameplay/)**           | Server-authoritative run submission, progress sync, cross-device saved runs.  | 01, 02     |
| **[04 · Economy](04-economy/)**             | XP and player levels, points, the Powers ledger, the shop.                    | 03         |
| **[05 · Retention](05-retention/)**         | Daily activity, streaks, freezes, daily goal, the weekly chart, daily quests. | 03         |
| **[06 · Leaderboards](06-leaderboards/)**   | Country and global boards, weekly and all-time, with the player's own rank.   | 03, 04     |
| **[07 · Platform](07-platform/)**           | Scheduled jobs, anti-cheat and observability, testing and rollout.            | all        |
| **[08 · Difficulty](08-difficulty/)**       | Timers, hearts, difficulty presets, typed powers, the attempt lifecycle.     | 02, 03, 04 |

## Appendices

- [`99-appendix/01-api-reference.md`](99-appendix/01-api-reference.md) — every endpoint in one table, with request and response shapes.
- [`99-appendix/02-schema.md`](99-appendix/02-schema.md) — the complete proposed Prisma schema.
- [`99-appendix/03-mobile-integration.md`](99-appendix/03-mobile-integration.md) — what changes in `../mobile-app`, file by file.
- [`99-appendix/04-deferred.md`](99-appendix/04-deferred.md) — what v1 deliberately leaves out, and how v1 stays compatible with it.

## Cross-cutting rules

These hold in every phase and are not restated per plan.

1. **Offline is the normal case, not the error case.** No endpoint may be on the critical
   path of starting or finishing a level. Runs queue on device and sync later; the server's
   answer overwrites the device's optimistic one when it arrives.
2. **The server owns the economy.** Stars, score, XP, points and Powers are derived
   server-side from `(levelId, mode, elapsedMs, powersUsed)`. The rules live in one ported
   module, `src/modules/game/rewards/`, mirroring `mobile-app/src/game/rewards.ts`.
3. **Everything a client can retry must be idempotent.** Every mutation that moves the
   economy carries a client-generated `clientRunId`/`idempotencyKey`, unique per user.
4. **Score is never spendable, and nothing purchasable may move a rank.** The mobile app's
   economy is deliberately split: score is the competitive stat and is never spent; Powers
   come from milestones; points are the only soft currency. The server preserves that split.
   Phase 08 extends it: an attempt rescued by a *purchased* time or recovery power pays full
   XP and progression but contributes nothing to leaderboard score.
5. **Read endpoints are cached, write endpoints are audited.** Level content and
   leaderboards go through `RedisService.getOrSet`. Every economy mutation writes a ledger
   row, not just a balance.
6. **The response envelope is already decided.** Mutations return
   `{ message, localeKey, status, data }` via `GlobalSuccessInterceptor`; errors return
   `{ message, statusCode, code, status, errors, requestId }`. Clients switch on `code`,
   never on `message`. `mobile-app/src/lib/api-error.ts` is already coded against this.

## API surface at a glance

Better Auth keeps its own mounted router at `/api/auth/*`. Everything in this plan lives
under `/v1`:

```
/v1/auth/*            existing — me, settings, account deletion
/v1/players/me        profile: display name, country, languages, age band
/v1/levels            level pack manifest + revisioned delta sync
/v1/runs              submit a finished run; saved-run snapshots
/v1/progress          per-level progress, wallet, counters; batch sync
/v1/economy           wallet, XP, points, Powers ledger
/v1/shop              catalog, purchase
/v1/streak            streak, freezes, daily goal, weekly chart
/v1/quests            today's quests, claim
/v1/leaderboard       global + country, weekly + all-time, with own rank
```

Note the mobile app's `src/lib/api.ts` currently sketches `/api/v1/*`. The backend mounts
at `/v1/*` (see `src/auth/auth.controller.ts`, `@Controller('auth')`). The app's endpoint
map is corrected in the mobile integration appendix — the backend does not move to match a
placeholder.
