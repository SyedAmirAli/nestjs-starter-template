# 06.1 · Leaderboards

**Goal:** back `leaderboard.tsx` — a podium of three, a list below, and the player's own row
pinned — for both country and global scopes, weekly and all-time.

## What ranks

**Score, and only score.** Not XP, not points, not levels cleared.

This is the whole reason `mobile-app/src/game/rewards.ts` was written the way it was: score
is earned by solving levels well, banks only each level's best, and is **never spendable**.
That is what makes a rank mean "played well" rather than "played long" or "spent money".
Ranking on XP would reward grinding; ranking on points would reward not shopping. Ranking on
score is the only choice consistent with the economy already designed.

## Scopes and windows

| Scope    | Window     | Key                                    |
| -------- | ---------- | -------------------------------------- |
| Global   | Weekly     | `lb:g:w:{isoYearWeek}`                 |
| Global   | All-time   | `lb:g:a`                               |
| Country  | Weekly     | `lb:c:{CC}:w:{isoYearWeek}`            |
| Country  | All-time   | `lb:c:{CC}:a`                          |

**The weekly window is one global UTC instant, not per-timezone.** A week that starts at a
different moment for each player is not a shared competition — two players could not compare
positions, and the reset would produce a rolling 24-hour ambiguity every Sunday. This is the
one place the per-player local-date rule of [05.1](01-streaks.md) is deliberately *not*
applied, and the app must say so: "Weekly · resets Monday 06:00" in local time.

Configured by `LEADERBOARD_WEEK_RESET_DOW` / `_HOUR`.

## Storage

**Redis sorted sets are the read path; Postgres is the truth.**

```
ZADD lb:c:BD:w:2026-W34  <weeklyScore>  <userId>
ZREVRANGE  … WITHSCORES        → a page
ZREVRANK   … <userId>          → the player's own rank, O(log n)
ZCARD      …                   → the population
```

A sorted set answers "top 50" and "what is my rank" in microseconds at any size. The
equivalent Postgres query is a window function over every player, which is fine at ten
thousand players and not fine at the numbers `country.tsx` already advertises.

Because Redis is a derivative, it must be rebuildable and it must be verified:

```prisma
/// Postgres side of the leaderboard. The rebuild job's source, and the answer to "what was
/// my rank last week" once the weekly Redis key has expired.
model LeaderboardEntry {
  id     String @id @default(uuid(7)) @db.Uuid
  userId String

  scope       LeaderboardScope
  /// ISO year-week ("2026-W34") for weekly, "ALL" for all-time.
  period      String
  countryCode String? @db.Char(2)

  score Int @default(0)
  /// Materialized at snapshot time only. Live rank always comes from Redis — a stored rank
  /// is stale the moment anyone else plays.
  rank  Int?

  updatedAt DateTime @updatedAt

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([userId, scope, period])
  @@index([scope, period, score(sort: Desc)])
  @@map("leaderboard_entries")
}

enum LeaderboardScope { GLOBAL  COUNTRY }
```

Writes happen **after** the run transaction commits, never inside it
([03-gameplay/01](../03-gameplay/01-run-submission.md), step 13). A Redis failure must not
roll back a completed level; the nightly rebuild repairs the drift.

## Eligibility

A player appears on a board only if **all** of these hold:

| Requirement                | Why                                                                          |
| -------------------------- | ---------------------------------------------------------------------------- |
| Not anonymous              | An anonymous account is a device, not a person. Leaderboards would otherwise rank installs, and a factory reset would be a strategy. |
| Has a `displayName`        | An unnamed row is not a competitor.                                          |
| Has a `countryCode`        | Country boards need one; global boards show a flag.                          |
| Not `UNDER_13`             | Global only. Under-13 players may appear on their country board with a first name — see [01-identity/03](../01-identity/03-player-profile.md). |
| `isActive`, not deleted    | Suspended accounts vanish from rankings.                                     |
| No unresolved run flags    | A flagged run's score is excluded pending review ([07-platform/02](../07-platform/02-anti-cheat.md)). |

Ineligible players still get a full read of the board — this is exactly the moment to
explain what signing in is for. The response carries `you.eligible: false` with a `reason`,
and the app renders "Sign in to join the leaderboard" in the pinned row where the rank would
be. `auth.tsx`'s "Save your progress?" sheet is one tap away.

## Endpoints

### `GET /v1/leaderboard?scope=country&period=weekly&limit=50&cursor=`

`scope` ∈ `global | country`. Country defaults to the player's own; `&country=BD` overrides
so the screen can show another country without changing a profile.

```jsonc
{
  "scope": "country",
  "country": { "code": "BD", "name": "Bangladesh" },
  "period": "weekly",
  "periodStart": "2026-08-17T00:00:00.000Z",
  "periodEnd":   "2026-08-24T00:00:00.000Z",
  "totalPlayers": 1204331,

  "podium": [
    { "rank": 1, "userId": "…", "displayName": "Nusrat", "countryCode": "BD",
      "score": 11840, "level": 34, "isYou": false },
    { "rank": 2, "displayName": "Tahmid", … },
    { "rank": 3, "displayName": "Arif",   … }
  ],
  "rows": [
    { "rank": 4, "displayName": "Sadia", "countryCode": "BD", "score": 7910,
      "level": 28, "isYou": false }
  ],

  "you": {
    "eligible": true,
    "reason": null,                       // ANONYMOUS | NO_DISPLAY_NAME | NO_COUNTRY | UNDER_13 | FLAGGED
    "rank": 24,
    "score": 1840,
    "percentile": 3.9,
    /// Points to the next rank up — the "340 XP to rank 23" line the screen already has.
    "toNextRank": 340,
    "nextRankScore": 2180
  },

  "nextCursor": "eyJj…"
}
```

`podium` is separated from `rows` because the screen renders them completely differently —
three gradient cards with badges versus a plain list. Splitting it server-side means the
client does not slice an array and special-case the first three, and page 2 correctly has no
podium.

`isYou` lets the client highlight the player's row when it happens to fall inside the page,
without comparing ids.

### `GET /v1/leaderboard/me`

Just the `you` block, for the Progress tab's rank chip. Cheap: two `ZREVRANK` calls.

### `GET /v1/leaderboard/countries`

Countries ranked by aggregate player score, for a country picker that shows where the action
is. Cached 1 hour.

## Privacy

What a stranger sees: `displayName`, `countryCode`, `score`, `level`, and an avatar once
avatars exist. **Never** email, never `userId` for another player (send an opaque per-board
id if the client ever needs one), never age band, never streak. `email` in particular must
not reach this serializer — the app's own `mock.globalBoard` has no email field and neither
should the API.

Under-13 players show a first name only, and only on their country board.

## Caching

- Board pages: `RedisService.getOrSet`, TTL 60s, keyed by `scope:period:country:cursor:limit`.
  A leaderboard 60 seconds out of date is not a defect; a leaderboard that costs a database
  query per pull-to-refresh is.
- `you`: **not cached.** The player's own rank must move the moment they finish a level, and
  they will check.

## Jobs

- **`LeaderboardSnapshot`** — hourly. Copies Redis scores into `LeaderboardEntry` so history
  survives key expiry and so a Redis flush is recoverable.
- **`LeaderboardRebuild`** — nightly, and on demand. Recomputes every board from
  `level_progress`/`runs` and replaces the sorted sets atomically (build into a temp key,
  then `RENAME`). This is what makes the after-commit write acceptable: drift is bounded by
  a day and repaired without intervention.
- **Weekly rollover** — at the configured UTC instant: snapshot the finishing week, write
  final ranks, start the new key. Old weekly keys get a 60-day TTL.

## Tasks

1. `LeaderboardEntry`, `LeaderboardScope` schema; migrate.
2. `LeaderboardService` — Redis sorted-set read/write, eligibility gate, serializers.
3. After-commit update hook in run submission, failure-tolerant.
4. Board, `me`, and countries endpoints with cursor pagination.
5. Snapshot, rebuild and weekly-rollover workers.
6. Mobile: replace `mock.countryBoard` / `mock.globalBoard`; render the ineligible state as a sign-in prompt.
7. Tests: eligibility matrix, rank correctness against a Postgres window function, rebuild-after-flush produces identical ranks.

## Definition of done

- Rank reads are O(log n) and stay so at a million players.
- Flushing Redis loses nothing that the nightly rebuild does not restore.
- No response contains another player's email or id.
- An anonymous player can view every board and is told, in place, exactly why they are not on one.
- `leaderboard.tsx` renders with no imports from `src/data/mock.ts`.
