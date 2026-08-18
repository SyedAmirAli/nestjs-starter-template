# 03.1 · Run submission — the server-authoritative core

**Goal:** one endpoint that takes the raw facts of a finished level and returns the
authoritative consequences. This is the most important endpoint in the system; almost
everything else reads what it writes.

## The principle

The client sends **what happened**. The server decides **what it was worth**.

```
client sends:  levelId, mode, elapsedMs, powersUsed, timestamps, clientRunId
server derives: stars, score, scoreGained, xp, points, powers granted,
                milestone progress, streak, quest progress, leaderboard position
```

Nothing in the request body is a reward. A client that sends `"score": 999999` is sending a
field that does not exist in the DTO, and `forbidNonWhitelisted` turns that into a 400.

The client still computes its own prediction locally — `mobile-app/src/game/rewards.ts`
already does, and the success screen must render instantly with no network. The server's
answer arrives moments later and replaces it. When they disagree, the server wins and the
client re-renders; the delta is logged (see [07-platform/02](../07-platform/02-anti-cheat.md)),
because a systematic disagreement means the two rule sets have drifted.

## Porting the rules

`src/modules/game/rewards/` is a **direct port of `mobile-app/src/game/rewards.ts`** —
plain functions, no Nest, no DI, no Prisma:

| Function                                          | Purpose                                            |
| ------------------------------------------------- | -------------------------------------------------- |
| `computeStars(elapsedSeconds, mode)`              | 3★ ≤ 15s word / 25s sentence; 2★ ≤ 60s / 90s; else 1★ |
| `speedMultiplier(elapsedSeconds, mode)`           | Piecewise-linear on fraction of par (45s / 70s), clamped to [0.4, 2.0] |
| `baseScore(chapter, mode)`                        | `(sentence ? 15 : 10) + 5 * (chapter - 1)`          |
| `computeScore({ chapter, mode, elapsedSeconds })` | `max(1, round(baseScore × speedMultiplier))`        |
| `scoreGain(newScore, previousBest)`               | Replays bank only the improvement                   |
| `milestonesReached(levelsCompleted)`              | `floor(n / 7)`                                      |
| `milestoneProgress(levelsCompleted)`              | The chest meter                                     |

Constants (`STAR_THRESHOLDS`, `PAR_SECONDS`, `SPEED_CURVE`, `POWERS_PER_MILESTONE = 3`,
`LEVELS_PER_MILESTONE = 7`) are copied verbatim. A parity test asserts both implementations
agree across a generated matrix — see [07-platform/03](../07-platform/03-testing-rollout.md).

New rules that exist only server-side (the client has no XP or points system yet):

```ts
/** XP comes from the level's own stored value, scaled by performance. */
xpForRun(level, mode, stars) =
    round((mode === 'sentence' ? level.sentenceXp : level.wordXp) * [1, 1.0, 1.25, 1.5][stars])

/** A replay pays a fraction, and only up to a daily ceiling — grinding one easy level
 *  must never out-earn progress. Mirrors scoreGain()'s intent for a currency that,
 *  unlike score, is not defined as a per-level maximum. */
REPLAY_XP_RATE = 0.25
REPLAY_XP_DAILY_CAP = 200

/** Points: the soft currency. Small per run, meaningful per quest. */
pointsForRun(chapter, stars) = (5 + chapter) * (stars === 3 ? 2 : 1)
REPLAY_POINTS_RATE = 0
```

Replays paying **zero points** is deliberate. Points buy Powers, Powers make levels easier,
and easier levels are faster to replay. Paying points for replays closes that loop into a
generator.

## Schema

```prisma
model Run {
  id     String @id @default(uuid(7)) @db.Uuid
  userId String

  levelNumber Int
  mode        GameMode
  chapter     Int        // denormalized: the level's chapter AT THE TIME OF THE RUN

  elapsedMs   Int
  powersUsed  Json       // { hint: 0, reveal: 1, shuffle: 0 }

  /// Everything the server derived. Stored, not recomputed on read: the rules may be
  /// re-tuned, and a run must always be worth what it was worth on the day it was played.
  stars       Int
  score       Int
  scoreGained Int
  xpGained    Int
  pointsGained Int

  isReplay    Boolean
  isPersonalBest Boolean

  /// Client idempotency key. Unique per user, so one device's collision cannot touch
  /// another player's data.
  clientRunId String @db.Uuid

  startedAt  DateTime
  finishedAt DateTime
  /// When the server received it. Differs from finishedAt by however long the device was
  /// offline, which is exactly what makes offline play work — and what anomaly detection reads.
  receivedAt DateTime @default(now())

  appVersion String?
  platform   String?

  /// Set when validation flagged the run. A flagged run is still recorded and still counts;
  /// it is excluded from leaderboards pending review. Silently dropping a legitimate fast
  /// player is worse than showing a flag to an operator.
  flaggedReason String?

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([userId, clientRunId])
  @@index([userId, finishedAt])
  @@index([userId, levelNumber, mode])
  @@index([flaggedReason])
  @@map("runs")
}

model LevelProgress {
  id     String @id @default(uuid(7)) @db.Uuid
  userId String

  levelNumber Int
  mode        GameMode

  stars      Int  @default(0)
  bestTimeMs Int?
  bestScore  Int  @default(0)
  attempts   Int  @default(0)

  firstClearedAt DateTime
  lastPlayedAt   DateTime

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([userId, levelNumber, mode])
  @@index([userId, mode])
  @@map("level_progress")
}

enum GameMode { WORD  SENTENCE }
```

`chapter` is denormalized onto `Run` on purpose. Score depends on chapter; if a level is
later moved to a different chapter, historical runs must not silently change value.

## `POST /v1/runs`

```jsonc
// request
{
  "clientRunId": "0192f3a1-…",     // UUIDv7, generated on device
  "levelNumber": 12,
  "mode": "word",                   // lowercase on the wire; GameMode.WORD in the DB
  "elapsedMs": 32400,
  "powersUsed": { "hint": 1, "reveal": 0, "shuffle": 2 },
  "startedAt": "2026-08-19T09:12:03.000Z",
  "finishedAt": "2026-08-19T09:12:35.400Z"
}
```

```jsonc
// 200 — the success interceptor's envelope
{
  "message": "Level complete",
  "localeKey": "created.run.complete",
  "status": "normal",
  "data": {
    "run": { "id": "…", "stars": 3, "score": 38, "scoreGained": 12,
             "xpGained": 45, "pointsGained": 14,
             "isReplay": false, "isPersonalBest": true, "flagged": false },
    "level": { "number": 12, "mode": "word", "chapter": 2,
               "bestStars": 3, "bestTimeMs": 32400, "previousBestTimeMs": 41100 },
    "wallet": { "totalScore": 1284, "points": 1254, "powers": 9,
                "xpTotal": 6525, "level": 12, "xpIntoLevel": 665, "xpForLevel": 1000 },
    "milestone": { "levelsCompleted": 15, "levelsIntoMilestone": 1,
                   "levelsRemaining": 6, "targetLevelCount": 21, "pct": 14.28,
                   "powersGranted": 0 },
    "streak": { "current": 15, "longest": 21, "extendedToday": true, "freezesLeft": 2 },
    "quests": [ { "id": "…", "code": "DAILY_THREE_LEVELS", "progress": 2, "target": 3,
                  "completed": false, "reward": { "points": 120 } } ],
    "leaderboard": { "countryRank": 23, "countryDelta": 1, "globalRank": 8210 }
  }
}
```

One response carries everything the post-level screens need.
`mobile-app/src/app/game/success.tsx` and `complete.tsx` currently reconstruct this from
local state and `mock.completion`; this payload is deliberately shaped to be a superset of
their existing `RunReward` type, so wiring it up is a swap rather than a rewrite.

`leaderboard` is best-effort: if the ranking read fails or times out, it is `null` and the
run still succeeds. A leaderboard outage must never fail a level completion.

## Processing order

All of it in **one Prisma transaction**:

```
1.  Idempotency — SELECT by (userId, clientRunId). Hit → return the stored result, 200.
2.  Load the level → chapter, wordXp/sentenceXp. Unknown level → 404 LEVEL_NOT_FOUND.
3.  Validate (see below). Fail hard → 422. Suspicious → set flaggedReason, continue.
4.  Derive stars, score, xp, points from the ported rules.
5.  Upsert LevelProgress: stars = max, bestTimeMs = min, bestScore = max, attempts += 1.
6.  scoreGained = scoreGain(score, previousBestScore); wallet.totalScore += scoreGained.
7.  XP + points ledger rows; recompute wallet balances and player level.
8.  Recount distinct cleared levels for the mode → milestonesReached → grant any unpaid
    Powers as MILESTONE_GRANT ledger rows.
9.  Upsert DailyActivity for the player's local date; recompute streak.
10. Advance today's quests.
11. Insert the Run row.
12. Commit.
13. AFTER commit, outside the transaction: update the Redis leaderboard sorted sets.
```

Step 13 is outside on purpose. A Redis write must never hold a Postgres transaction open,
and a Redis failure must never roll back a completed level. The sorted sets are a
derivative that a nightly rebuild job repairs
([06-leaderboards/01](../06-leaderboards/01-leaderboards.md)).

Step 8's "recount distinct cleared levels" rather than "increment a counter" is the same
reasoning as the client's: milestones are paid by count, so a replay can never pay twice.
`wallet.milestonesPaid[mode]` records what has been settled.

## Validation

Reject outright (**422 `RUN_IMPLAUSIBLE`**):

| Check                     | Rule                                                                        |
| ------------------------- | --------------------------------------------------------------------------- |
| Minimum solve time        | `elapsedMs >= tileCount × RUN_MIN_SECONDS_PER_TILE × 1000`, where `tileCount` is the answer's letters (word) or words (sentence). At 0.35 s/tile, "FLOWER" cannot be solved in under 2.1 s. |
| Maximum solve time        | `elapsedMs <= 2 hours`. Beyond that the timer was paused or the payload is junk. |
| Timestamp coherence       | `finishedAt - startedAt` within ±5 s of `elapsedMs`.                        |
| Not from the future       | `finishedAt <= now + 5 min` (clock skew tolerance).                          |
| Not ancient               | `finishedAt >= now - 30 days`. Older offline queues are accepted for progress but pay no points and do not touch streaks. |
| Powers plausible          | `hint + reveal + shuffle <= 20`, and `reveal <= tileCount`.                  |
| Level exists and is live  | not `retiredAt`.                                                             |

Flag but accept (`flaggedReason`, excluded from leaderboards, surfaced to an operator):

- Every run in a 24h window at exactly 3 stars with sub-2× minimum time.
- More than 200 runs submitted in one hour.
- A `receivedAt - finishedAt` gap over 30 days on a device that is otherwise online.
- Powers spent that the wallet never held.

The asymmetry is intentional. Hard rejection is reserved for the physically impossible;
everything merely improbable is recorded and reviewed, because the alternative is telling a
genuinely fast player that they cheated.

## Rate limit

60 runs per 5 minutes per user. A level takes tens of seconds; 60 in five minutes is already
well beyond human play and far below what a script would want.

## Tasks

1. Port `rewards/` verbatim; add `xpForRun`, `pointsForRun`, replay rates.
2. `Run`, `LevelProgress`, `GameMode` schema; migrate.
3. `RunModule` — controller, `RunService.submit()`, `RunValidator`, DTOs.
4. Idempotency by `@@unique([userId, clientRunId])`, replay returns the stored result.
5. Redis leaderboard update as an after-commit hook.
6. Unit tests for every validation rule and every reward branch; parity test against the client's implementation.
7. e2e: submit → replay the same `clientRunId` → identical response, one `Run` row, no double payment.

## Definition of done

- No request body field can influence a reward except `elapsedMs` and `powersUsed`.
- Submitting the same run twenty times pays once.
- A level cleared offline three weeks ago syncs, records progress, and does not resurrect a
  dead streak.
- Client-predicted and server-computed rewards agree on every level × mode × time in the
  parity matrix.
