# 05.2 · Daily quests

**Goal:** back the "Earn points free" section of `shop.tsx` — today "Daily quest · Finish 3
levels today · 120 points" — with a real, server-rolled, server-verified quest system.

## Design

A quest is a **definition** (the rule, authored once) plus a **daily instance** (this
player, this day, this progress). Definitions are data, not code, so adding "solve a level
with no Powers" is a row rather than a release.

Instances are rolled at the player's local midnight by the same hourly job that handles
streak rollover, and are keyed on `localDate` — the same date rule as
[05.1](01-streaks.md), for the same reasons.

## Schema

```prisma
model QuestDefinition {
  id String @id @default(uuid(7)) @db.Uuid

  code String @unique          // DAILY_THREE_LEVELS, DAILY_PERFECT_RUN
  title       String           // "Daily quest"
  description String           // "Finish 3 levels today"
  iconKey     String

  type   QuestType
  target Int                   // 3 levels, 20 minutes, 2 three-star runs

  /// Restricts which runs count. Null = any.
  mode      GameMode?
  minStars  Int?
  /// True = the run must have used zero Powers. Reads Run.powersUsed.
  noPowers  Boolean @default(false)

  rewardPoints Int  @default(0)
  rewardXp     Int  @default(0)
  rewardPowers Int  @default(0)

  /// Relative likelihood when the daily set is drawn. Lets an easy quest appear often and
  /// a hard one rarely, without a separate difficulty tier.
  weight   Int     @default(1)
  isActive Boolean @default(true)

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  instances QuestInstance[]

  @@index([isActive])
  @@map("quest_definitions")
}

enum QuestType {
  COMPLETE_LEVELS      // N levels cleared
  EARN_XP              // N XP earned
  PLAY_MINUTES         // N minutes of active play
  PERFECT_RUNS         // N runs at 3 stars
  NEW_LEVELS           // N levels cleared for the FIRST time — replays do not count
  STREAK_MAINTAIN      // play at all today
}

model QuestInstance {
  id     String @id @default(uuid(7)) @db.Uuid
  userId String
  definitionId String @db.Uuid

  /// The player's local date this instance belongs to.
  localDate DateTime @db.Date

  progress Int @default(0)
  target   Int                 // COPIED from the definition at roll time — retuning a
                               // quest must never move today's goalposts mid-day.

  completedAt DateTime?
  claimedAt   DateTime?

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  user       User            @relation(fields: [userId], references: [id], onDelete: Cascade)
  definition QuestDefinition @relation(fields: [definitionId], references: [id], onDelete: Restrict)

  @@unique([userId, localDate, definitionId])
  @@index([userId, localDate])
  @@map("quest_instances")
}
```

Copying `target` onto the instance is the same discipline as copying `pricePaid` onto a
purchase and `chapter` onto a run: **a record of what happened must not change when the
rules change.**

## Rolling

Three quests per day, drawn by `weight` without replacement. The draw is **deterministic per
(userId, localDate)** — seed a PRNG with a hash of the two. That means:

- The rollover job and a lazy on-read roll produce identical sets, so a player who opens the
  app before the job reaches their timezone sees the right quests and nothing is
  double-created.
- Re-running the job is a no-op.
- "Why did I get different quests when I reopened the app" never happens.

`STREAK_MAINTAIN` is always included as one of the three; it is the quest that exists to
make opening the app worthwhile, and randomising it away defeats it.

Rolling happens at whichever comes first: the hourly rollover job crossing the player's
local midnight, or the player's first `GET /v1/quests` of the local day. The lazy path is
what makes the feature correct for a player whose timezone the job has not reached, and for
a brand-new account.

## Progress

Step 10 of [run submission](../03-gameplay/01-run-submission.md), same transaction. After
the run's effects are known:

```
for each unclaimed instance for (userId, today):
    delta = contributionOf(run, instance.definition)
    if delta > 0:
        progress = min(target, progress + delta)
        if progress >= target and completedAt is null: completedAt = now
```

`contributionOf` is a pure function over the run and the definition — filtered by `mode`,
`minStars`, `noPowers`, and by `isReplay` for `NEW_LEVELS`. Pure, so it is unit-testable
without a database, which for a rules engine that will grow is the difference between
confident and hopeful.

Quests advance **only from runs the server accepted**. A run rejected as implausible
contributes nothing.

## Claiming

Rewards are **claimed, not auto-granted**. Two reasons: the app gets a moment worth
animating, and an unclaimed reward is recoverable if a client crashes at exactly the wrong
time, whereas an auto-granted one that the client never rendered is invisible.

### `GET /v1/quests`

```jsonc
{
  "localDate": "2026-08-19",
  /// When today's set expires, so the client can show a countdown without
  /// guessing at the player's midnight.
  "resetsAt": "2026-08-19T18:00:00.000Z",
  "quests": [
    { "id": "…", "code": "DAILY_THREE_LEVELS", "title": "Daily quest",
      "description": "Finish 3 levels today", "iconKey": "icon.icon-daily-quest",
      "progress": 2, "target": 3, "completed": false, "claimed": false,
      "reward": { "points": 120, "xp": 0, "powers": 0 } },
    { "id": "…", "code": "DAILY_STREAK", "title": "Keep the flame",
      "description": "Play one level today", "iconKey": "icon.icon-streak-active",
      "progress": 1, "target": 1, "completed": true, "claimed": false,
      "reward": { "points": 40, "xp": 0, "powers": 0 } }
  ]
}
```

### `POST /v1/quests/:id/claim`

```
Idempotency-Key: 0192f3a1-…
```

```jsonc
// 200
{ "message": "Reward claimed", "localeKey": "created.quest.claim", "status": "normal",
  "data": { "questId": "…", "granted": { "points": 120, "xp": 0, "powers": 0 },
            "wallet": { "points": 1374, "powers": 9, "xpTotal": 6525 } } }
```

In one transaction: instance belongs to the caller (else 404) → `completedAt` is set (else
`409 QUEST_NOT_COMPLETE`) → `claimedAt` is null (else return the stored result, 200) → credit
each non-zero reward as a `QUEST_REWARD` ledger entry with `subjectId = questInstanceId` →
set `claimedAt`.

**An expired unclaimed quest can still be claimed for 48 hours.** A player who completes a
quest at 23:55 and closes the app has earned it. After 48 hours the housekeeping job marks
it forfeited.

## Seeding

From `mock.freePoints` plus the obvious first set:

| code                   | description                        | type              | target | reward     |
| ---------------------- | ---------------------------------- | ----------------- | ------ | ---------- |
| `DAILY_STREAK`         | Play one level today               | `STREAK_MAINTAIN` | 1      | 40 points  |
| `DAILY_THREE_LEVELS`   | Finish 3 levels today              | `COMPLETE_LEVELS` | 3      | 120 points |
| `DAILY_NEW_LEVELS`     | Clear 2 new levels                 | `NEW_LEVELS`      | 2      | 100 points |
| `DAILY_PERFECT`        | Earn 3 stars on any level          | `PERFECT_RUNS`    | 1      | 90 points  |
| `DAILY_SENTENCE`       | Finish 2 sentence levels           | `COMPLETE_LEVELS` | 2      | 100 points |
| `DAILY_FOCUS`          | Play for 15 minutes                | `PLAY_MINUTES`    | 15     | 110 points |
| `DAILY_NO_POWERS`      | Clear a level without Powers       | `COMPLETE_LEVELS` | 1      | 80 points  |

`mock.freePoints`'s second row — "Invite a friend · 500 points" — is a referral, not a
quest, and is [deferred](../99-appendix/04-deferred.md).

## Tasks

1. `QuestDefinition`, `QuestInstance`, `QuestType` schema; migrate.
2. `scripts/seed-quests.ts` with the table above.
3. Deterministic weighted draw seeded on `hash(userId, localDate)`.
4. `contributionOf(run, definition)` — pure, exhaustively unit-tested.
5. Advance inside run submission's transaction; lazy roll inside `GET /v1/quests`.
6. Claim with idempotency and ledger entries.
7. `QuestRolloverWorker` on the hourly cron; 48-hour forfeit sweep.
8. e2e: three levels → quest completes → claim → points move once → re-claim returns the same result and moves nothing.

## Definition of done

- The same player on the same local date always sees the same three quests.
- Retuning a definition does not change any quest already rolled.
- A quest can be claimed exactly once, ever.
- The "Earn points free" section of `shop.tsx` renders with no imports from `src/data/mock.ts`.
