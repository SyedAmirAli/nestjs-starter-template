# 05.1 · Daily activity, streaks, freezes, and the weekly chart

**Goal:** make `streak.tsx` and the Progress tab's weekly chart real — correctly, for a
player in Dhaka.

## The hard part is the calendar, not the counter

A streak is "did you play yesterday, and the day before". Every bug in every streak feature
ever shipped comes from the word **day**.

The rule for this system, stated once and applied everywhere:

> A run belongs to the **local calendar date of `finishedAt`, in the player's IANA
> timezone**, taken from `UserMeta.timezone`, defaulting to `UTC`.

Consequences that follow, and each is a real bug avoided:

- A player in `Asia/Dhaka` (UTC+6) finishing a level at 02:00 local on the 19th has played
  on the 19th — not on the 18th, which is what UTC would say.
- A run **synced** three days late still counts for the day it was **finished**. Offline
  play cannot break a streak. `receivedAt` is for anomaly detection only; `finishedAt`
  decides the day.
- Changing timezone does **not** recompute history. Stored `localDate` values are frozen at
  write time. Recomputing on every timezone change would let a traveller lose a streak by
  flying east, and would make the column non-deterministic.
- Days are compared as `DATE` values, never as timestamp arithmetic. "24 hours ago" is not
  "yesterday".

`UserMeta.timezone`'s own docblock already says it is "the one time value the server stores
rather than leaving to the client, because … delivery windows are computed server-side."
This is that reason, made concrete. The client must set it on first launch and whenever the
device timezone changes.

## Schema

```prisma
/// One row per player per local day on which they did anything. The source of truth for
/// streaks, the weekly chart and the daily goal — all three are queries over this table
/// rather than three separately-maintained counters that can disagree.
model DailyActivity {
  id     String @id @default(uuid(7)) @db.Uuid
  userId String

  /// The player's LOCAL date, frozen at write time. Not a timestamp: the whole point is
  /// that this is a calendar day, and calendar days are not durations.
  localDate DateTime @db.Date
  /// The timezone that produced localDate, kept so a support question about a boundary
  /// case is answerable a year later.
  timezone  String

  levelsCompleted Int @default(0)
  runsSubmitted   Int @default(0)
  xpEarned        Int @default(0)
  pointsEarned    Int @default(0)
  /// Seconds of actual play, summed from run elapsedMs. Not wall-clock app time — the
  /// daily goal should mean "played", not "left the app open".
  activeSeconds   Int @default(0)

  /// True when a freeze was consumed to cover this day rather than the player playing.
  freezeUsed Boolean @default(false)

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([userId, localDate])
  @@index([userId, localDate(sort: Desc)])
  @@map("daily_activity")
}

model Streak {
  id     String @id @default(uuid(7)) @db.Uuid
  userId String @unique

  current Int @default(0)
  longest Int @default(0)

  /// The most recent local date that counts toward the streak — played or frozen.
  lastActiveDate DateTime? @db.Date

  /// Consumables that cover exactly one missed day. Earned at streak milestones and
  /// buyable in the shop; capped so they cannot be stockpiled into permanence.
  freezes    Int @default(2)
  freezesMax Int @default(3)

  /// Minutes. Player-adjustable; mock.player defaults to 20.
  dailyGoalMinutes Int @default(20)

  updatedAt DateTime @updatedAt

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@map("streaks")
}
```

`Streak` is a cache over `DailyActivity`, exactly as `Wallet` is a cache over
`LedgerEntry`. It can always be rebuilt, and the nightly job verifies it can.

## Advancing the streak — inline, at run submission

Step 9 of [run submission](../03-gameplay/01-run-submission.md), in the same transaction:

```
localDate = toLocalDate(run.finishedAt, tz)

UPSERT DailyActivity(userId, localDate) — increment counters

if localDate == streak.lastActiveDate          → nothing to do
elif localDate == lastActiveDate + 1 day       → current += 1
elif lastActiveDate is null                    → current  = 1
elif localDate  > lastActiveDate + 1 day       → current  = 1        (gap; see rollover)
elif localDate  < lastActiveDate               → backfill (below)
longest = max(longest, current)
lastActiveDate = max(lastActiveDate, localDate)
```

**Backfill** is the case a late offline sync creates: a run finished on a day *earlier* than
`lastActiveDate`. Do not patch the counter incrementally — recompute the streak from
`DailyActivity` over the last 400 days. It is one indexed query, it happens rarely, and
incremental patching of an out-of-order insert is where streak bugs live.

## Rollover and freezes — the nightly job

`QueueName.StreakRollover`, driven by a repeatable BullMQ job that runs **hourly**, not
daily. Local midnight happens at a different UTC instant in every timezone; an hourly job
processes exactly the timezones that just crossed it.

```
for each timezone tz where local time just passed 00:30:
  for each player in tz with lastActiveDate == yesterday-1 (i.e. missed yesterday):
      if streak.freezes > 0 and streak.current > 0:
          freezes -= 1
          UPSERT DailyActivity(yesterday, freezeUsed: true)
          lastActiveDate = yesterday          # streak preserved, not incremented
      else:
          current = 0                          # streak broken
```

Freezes are consumed **the day after** the miss, not at the moment of missing. A player who
plays at 23:58 must not have a freeze taken at 23:00 "just in case". The 00:30 offset gives
a half-hour grace for a late sync.

A broken streak is not deleted — `longest` survives, and `streak.tsx` shows "LONGEST EVER"
from it.

## Reads

### `GET /v1/streak`

```jsonc
{
  "current": 14,
  "longest": 21,
  "freezes": 2,
  "freezesMax": 3,
  "lastActiveDate": "2026-08-19",
  "extendedToday": true,
  "today": { "localDate": "2026-08-19", "activeMinutes": 18,
             "goalMinutes": 20, "goalMet": false, "levelsCompleted": 3 },
  "last14Days": [
    { "date": "2026-08-06", "weekday": "Thu", "played": true,  "freezeUsed": false },
    …
    { "date": "2026-08-19", "weekday": "Wed", "played": true,  "freezeUsed": false }
  ]
}
```

`last14Days` is exactly what `streak.tsx` renders — it currently fakes it with
`const done = i < 13`. Fourteen entries, oldest first, one per calendar day with no gaps:
days with no activity appear with `played: false` rather than being absent, so the client
renders a grid rather than reconstructing a calendar.

### `GET /v1/streak/weekly`

The Progress tab's bar chart.

```jsonc
{
  "weekStart": "2026-08-17",         // player-local, ISO weeks (Mon-start)
  "totalXp": 1840,
  "days": [
    { "date": "2026-08-17", "weekday": "Mon", "xp": 210, "isToday": false },
    …
    { "date": "2026-08-23", "weekday": "Sun", "xp": 0,   "isToday": false }
  ]
}
```

Always seven entries, Monday-first, matching `mock.weekdays`. Future days in the current
week are present with `xp: 0` — the chart has seven bars whether or not the week is over.
The client's `strong` flag (used for bar shading) is a presentation decision and stays
client-side; the server sends only XP.

### `PATCH /v1/streak/goal`

```jsonc
{ "dailyGoalMinutes": 30 }        // 5–120, multiples of 5
```

## Freeze acquisition

- **Streak milestones**: +1 freeze at 7, 30 and 100 days, capped at `freezesMax`.
- **Shop**: a `STREAK_FREEZE_1` item at 300 points, `purchaseLimit` respecting the cap.

Capping at 3 is what stops freezes turning a streak into an attendance record. A player who
can bank thirty freezes has a thirty-day holiday from the mechanic the streak exists to
create.

## Timezone changes

`PUT /v1/auth/me/settings` already accepts `timezone`. On change:

- **Do not** recompute historical `localDate` values.
- Guard against abuse: a timezone change more than twice in 24h is flagged, since hopping
  timezones is a way to manufacture two "days" in one. The streak advance already refuses to
  increment twice for the same `localDate`, which blunts most of it; the flag catches the
  rest.

## Tasks

1. `DailyActivity`, `Streak` schema; migrate. Seed `Streak` in `user.create.after`.
2. `RetentionService.recordActivity()` — transaction-scoped, called from run submission.
3. `recomputeStreak(userId)` from `DailyActivity`, used for backfill and for merge.
4. Hourly `StreakRolloverWorker` with per-timezone bucketing and freeze consumption.
5. `GET /v1/streak`, `GET /v1/streak/weekly`, `PATCH /v1/streak/goal`.
6. Mobile: send `timezone` on first launch and on change; replace `mock.player.streak`, `weeklyXp` and the faked 14-day grid.
7. Tests: DST transitions, UTC+14 and UTC−11, a run synced 3 days late, two runs either side of local midnight, a freeze consumed exactly once.

## Definition of done

- A player in `Asia/Dhaka` playing at 01:00 local extends today's streak, not yesterday's.
- A week offline, then a sync, produces the same streak as if every run had been submitted live.
- A freeze is consumed at most once per missed day and never while the player still could play.
- `streak.tsx` and the Progress chart render with no imports from `src/data/mock.ts`.
