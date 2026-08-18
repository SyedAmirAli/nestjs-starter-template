# A2 · The complete v1 schema

Every model this plan adds or changes, in one place. Existing models are shown only where
they change.

> **Phase 08 amends this appendix.** See
> [08-difficulty/01](../08-difficulty/01-constraint-config.md) and
> [03](../08-difficulty/03-power-architecture.md) for `DifficultyPreset`, `Level`'s
> constraint columns, `PowerDefinition`, `PowerInventory`, `LedgerEntry.power`, and `Run`'s
> attempt fields. The one **replacement** rather than addition: `Wallet.powers` is dropped in
> favour of typed `PowerInventory` rows.

Conventions carried from the current schema without exception: UUIDv7 primary keys on
everything we own, `snake_case` `@@map`, and **every user-owned row cascades from `User`**
so account deletion stays a single `DELETE`.

## Changes to existing models

```prisma
model User {
  // …all existing fields unchanged…

  /// Better Auth's anonymous plugin. `input: false` in additionalFields — a client that
  /// could clear this would promote its own guest account to leaderboard-eligible.
  isAnonymous Boolean @default(false)

  profile     PlayerProfile?
  wallet      Wallet?
  streak      Streak?
  integrity   PlayerIntegrity?

  runs          Run[]
  levelProgress LevelProgress[]
  savedRuns     SavedRun[]
  ledger        LedgerEntry[]
  purchases     Purchase[]
  dailyActivity DailyActivity[]
  quests        QuestInstance[]
  leaderboard   LeaderboardEntry[]

  @@index([isAnonymous])
}

model UserMeta {
  // pageSize DELETED — PDF page size, from the inherited product.
  // Everything else unchanged. `timezone` becomes load-bearing (see 05-retention/01).
}

// DELETED: ModelCall, ModelCallFeature, ModelCallOperation
// CHANGED:  enum FileKind { AVATAR  DATA_EXPORT }   — was résumé/JD kinds
```

## Identity

```prisma
model PlayerProfile {
  id String @id @default(uuid(7)) @db.Uuid

  displayName String?                 // 1–16 chars, screened; shown on leaderboards
  countryCode String? @db.Char(2)     // ISO-3166-1 alpha-2, validated against the published list

  nativeLanguage   String @default("bn")
  learningLanguage String @default("en")

  ageBand   AgeBand?
  interests String[] @default([])

  mergeState MergeState @default(NONE)

  onboardingCompletedAt DateTime?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  userId String @unique
  user   User   @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([countryCode])
  @@map("player_profiles")
}

enum AgeBand    { UNDER_13  AGE_13_17  AGE_18_24  AGE_25_PLUS }
enum MergeState { NONE  PENDING  RUNNING  DONE  FAILED }
```

## Content

```prisma
model LevelPack {
  id String @id @default(uuid(7)) @db.Uuid

  nativeLanguage   String
  learningLanguage String

  /// Monotonic; bumped only by the publish transaction. The entire sync contract.
  revision    Int @default(0)
  /// Bumped for changes a delta cannot express. Forces a client full-resync.
  packVersion Int @default(1)

  publishedAt DateTime?
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt

  levels   Level[]
  chapters Chapter[]

  @@unique([nativeLanguage, learningLanguage])
  @@map("level_packs")
}

model Chapter {
  id     String @id @default(uuid(7)) @db.Uuid
  packId String @db.Uuid

  number Int
  title  String
  artKey String?              // asset key in the client registry, not a URL

  levels Level[]
  pack   LevelPack @relation(fields: [packId], references: [id], onDelete: Cascade)

  @@unique([packId, number])
  @@map("chapters")
}

model Level {
  id        String @id @default(uuid(7)) @db.Uuid
  packId    String @db.Uuid
  chapterId String @db.Uuid

  /// What the player sees and every run/progress row keys on. Stable for the pack's life.
  number Int

  wordEn              String
  wordBn              String
  wordPronunciation   String
  wordBnPronunciation String
  wordXp              Int

  sentenceEn            String
  sentenceBn            String
  sentencePronunciation String
  sentenceXp            Int

  /// Withdrawn, not deleted — the delta needs a tombstone to send.
  retiredAt DateTime?
  revision  Int @default(0)

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  pack    LevelPack @relation(fields: [packId], references: [id], onDelete: Cascade)
  chapter Chapter   @relation(fields: [chapterId], references: [id], onDelete: Restrict)

  @@unique([packId, number])
  @@index([packId, revision])
  @@map("levels")
}
```

## Gameplay

```prisma
enum GameMode { WORD  SENTENCE }     // serialized lowercase on the wire

model Run {
  id     String @id @default(uuid(7)) @db.Uuid
  userId String

  levelNumber Int
  mode        GameMode
  chapter     Int          // denormalized at run time — score depends on it

  elapsedMs  Int
  powersUsed Json

  stars        Int
  score        Int
  scoreGained  Int
  xpGained     Int
  pointsGained Int

  isReplay       Boolean
  isPersonalBest Boolean

  clientRunId String @db.Uuid

  startedAt  DateTime
  finishedAt DateTime          // decides the calendar day
  receivedAt DateTime @default(now())   // anomaly detection only

  appVersion String?
  platform   String?

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

model SavedRun {
  id     String @id @default(uuid(7)) @db.Uuid
  userId String

  levelNumber Int
  mode        GameMode

  slots     Int[]
  tileOrder Int[]
  powers    Json
  elapsedMs Int

  /// Indices only mean something against the answer they were derived from.
  packRevision Int

  updatedAt DateTime @updatedAt

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([userId, levelNumber, mode])
  @@map("saved_runs")
}
```

## Economy

```prisma
model Wallet {
  id     String @id @default(uuid(7)) @db.Uuid
  userId String @unique

  totalScore Int @default(0)     // Σ best_score over level_progress; recomputed, never blindly incremented
  xpTotal    Int @default(0)
  points     Int @default(0)
  powers     Int @default(0)

  wordMilestonesPaid     Int @default(0)
  sentenceMilestonesPaid Int @default(0)

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@map("wallets")
}

model LedgerEntry {
  id     String @id @default(uuid(7)) @db.Uuid
  userId String

  currency Currency
  amount   Int          // signed: credits positive, debits negative
  source   LedgerSource

  subjectId String? @db.Uuid    // run, purchase or quest — untyped on purpose
  note      String?

  balanceAfter Int

  createdAt DateTime @default(now())

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, currency, createdAt])
  @@index([subjectId])
  @@map("ledger_entries")
}

enum Currency { SCORE  XP  POINTS  POWERS }

enum LedgerSource {
  RUN_COMPLETE  RUN_REPLAY  MILESTONE_GRANT  QUEST_REWARD  STREAK_REWARD
  SHOP_PURCHASE  POWER_SPEND  REFERRAL_REWARD  GUEST_MERGE  ADMIN_ADJUST
}

model ShopItem {
  id   String @id @default(uuid(7)) @db.Uuid
  code String @unique

  title    String
  category ShopCategory
  iconKey  String

  priceKind   PriceKind @default(POINTS)
  pricePoints Int

  grants Json                 // { "powers": 5 } | { "freezes": 1 }

  isBest    Boolean @default(false)
  sortOrder Int     @default(0)

  purchaseLimit Int?
  availableFrom DateTime?
  availableTo   DateTime?
  isActive      Boolean  @default(true)

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  purchases Purchase[]

  @@index([isActive, sortOrder])
  @@map("shop_items")
}

enum ShopCategory { POWERS  POINTS  BUNDLES }
enum PriceKind    { POINTS  IAP }

model Purchase {
  id     String @id @default(uuid(7)) @db.Uuid
  userId String
  itemId String @db.Uuid

  pricePaid   Int          // at purchase time — a later price change must not rewrite history
  grantsGiven Json

  idempotencyKey String @db.Uuid

  createdAt DateTime @default(now())

  user User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  item ShopItem @relation(fields: [itemId], references: [id], onDelete: Restrict)

  @@unique([userId, idempotencyKey])
  @@index([userId, createdAt])
  @@map("purchases")
}
```

## Retention

```prisma
model DailyActivity {
  id     String @id @default(uuid(7)) @db.Uuid
  userId String

  localDate DateTime @db.Date      // the player's LOCAL date, frozen at write time
  timezone  String                 // the tz that produced it

  levelsCompleted Int @default(0)
  runsSubmitted   Int @default(0)
  xpEarned        Int @default(0)
  pointsEarned    Int @default(0)
  activeSeconds   Int @default(0)

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

  lastActiveDate DateTime? @db.Date

  freezes    Int @default(2)
  freezesMax Int @default(3)

  dailyGoalMinutes Int @default(20)

  updatedAt DateTime @updatedAt

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@map("streaks")
}

model QuestDefinition {
  id   String @id @default(uuid(7)) @db.Uuid
  code String @unique

  title       String
  description String
  iconKey     String

  type   QuestType
  target Int

  mode     GameMode?
  minStars Int?
  noPowers Boolean @default(false)

  rewardPoints Int @default(0)
  rewardXp     Int @default(0)
  rewardPowers Int @default(0)

  weight   Int     @default(1)
  isActive Boolean @default(true)

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  instances QuestInstance[]

  @@index([isActive])
  @@map("quest_definitions")
}

enum QuestType {
  COMPLETE_LEVELS  EARN_XP  PLAY_MINUTES  PERFECT_RUNS  NEW_LEVELS  STREAK_MAINTAIN
}

model QuestInstance {
  id           String @id @default(uuid(7)) @db.Uuid
  userId       String
  definitionId String @db.Uuid

  localDate DateTime @db.Date

  progress Int @default(0)
  target   Int              // copied at roll time — retuning must not move today's goalposts

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

## Leaderboards and integrity

```prisma
model LeaderboardEntry {
  id     String @id @default(uuid(7)) @db.Uuid
  userId String

  scope       LeaderboardScope
  period      String            // "2026-W34" or "ALL"
  countryCode String? @db.Char(2)

  score Int  @default(0)
  rank  Int?                    // snapshot only; live rank is always Redis

  updatedAt DateTime @updatedAt

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([userId, scope, period])
  @@index([scope, period, score(sort: Desc)])
  @@map("leaderboard_entries")
}

enum LeaderboardScope { GLOBAL  COUNTRY }

model PlayerIntegrity {
  id     String @id @default(uuid(7)) @db.Uuid
  userId String @unique

  state   IntegrityState @default(CLEAN)
  signals String[]       @default([])

  reviewedBy   String?
  reviewedAt   DateTime?
  reviewerNote String?

  updatedAt DateTime @updatedAt

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([state])
  @@map("player_integrity")
}

enum IntegrityState { CLEAN  WATCHED  SHADOWED  SUSPENDED }
```

## Migration order

Each is its own migration, matching the phase that introduces it. `prisma migrate deploy`
runs as an explicit deploy step, never at boot.

| # | Migration                    | Contents                                                              |
| - | ---------------------------- | --------------------------------------------------------------------- |
| 1 | `domain_realignment`         | Drop `model_calls`; rewrite `FileKind`; drop `UserMeta.pageSize`       |
| 2 | `anonymous_accounts`         | `User.isAnonymous` + index                                            |
| 3 | `player_profile`             | `PlayerProfile`, `AgeBand`, `MergeState`                              |
| 4 | `level_pack`                 | `LevelPack`, `Chapter`, `Level`                                       |
| 5 | `gameplay`                   | `GameMode`, `Run`, `LevelProgress`, `SavedRun`                        |
| 6 | `economy`                    | `Wallet`, `LedgerEntry`, `Currency`, `LedgerSource`                   |
| 7 | `shop`                       | `ShopItem`, `Purchase`, `ShopCategory`, `PriceKind`                   |
| 8 | `retention`                  | `DailyActivity`, `Streak`, `QuestDefinition`, `QuestInstance`, `QuestType` |
| 9 | `leaderboard_integrity`      | `LeaderboardEntry`, `LeaderboardScope`, `PlayerIntegrity`, `IntegrityState` |

Backfills that accompany them:

- After #3, #6, #8: seed `PlayerProfile`, `Wallet` and `Streak` for every existing user
  (there are none at the time of writing, but the script must exist and be idempotent —
  the same seeding also runs in `user.create.after` for new accounts).
- After #4: `scripts/seed-levels.ts` from `mobile-app/src/data/levels.json`.
- After #7: `scripts/seed-shop.ts` from `mock.shopPowers`.
- After #8: `scripts/seed-quests.ts`.
