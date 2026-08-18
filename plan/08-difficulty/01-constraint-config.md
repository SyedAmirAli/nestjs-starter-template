# 08.1 · Constraint configuration — timers, hearts and difficulty presets

**Goal:** let a designer change how hard a level is by editing a row, never by editing
application code — and make "which constraints are in force right now" a question with one
answer, computed the same way on both sides.

## The four modes

A level's constraints are two independent switches, which gives the four configurations the
design calls for:

| Mode              | `timerEnabled` | `heartsEnabled` | Feel                                  |
| ----------------- | -------------- | --------------- | ------------------------------------- |
| No restriction    | false          | false           | Today's game. Learning, unpressured.  |
| Hearts only       | false          | true            | Precision. Think before you commit.   |
| Timer only        | true           | false           | Pace. Keep moving.                    |
| Timer + hearts    | true           | true            | The challenge configuration.          |

They are genuinely independent — no code path may assume one implies the other.

## Resolution order

Three layers, resolved in this order, last wins:

```
DifficultyPreset defaults
  ← Level per-column overrides (nullable; null means "inherit")
    ← Runtime rules (the first-clear rule below)
```

The first two are content and resolve **server-side at publish time**, so the level delta
ships a fully-resolved config and the client does no inheritance logic. The third depends on
the player, so it resolves **on both sides from the same stated rule**.

### The first-clear rule

Decided in this update: **a timer never appears on a level the player has not yet cleared.**

```
timerActive = level.timerEnabled && playerHasCleared(levelNumber, mode)
```

Learning a word is untimed. The timer is a challenge layer over material already known,
which is also exactly where speed-based scoring and leaderboards belong. First clears keep
the game's current character; replays gain the pressure.

Hearts are **not** subject to this rule — they apply from the first attempt. Hearts limit
wrong attempts, which is a fairness constraint rather than a recall-under-pressure one, and
gating them would make a level's first clear meaningfully different from its shape.

The client evaluates `playerHasCleared` from local SQLite; the server evaluates it from
`LevelProgress.firstClearedAt`. Both must call the same named helper —
`resolveConstraints(level, progress)` — because a divergence here means a run is validated
against a timer the player never saw.

## Schema

```prisma
/// Reusable difficulty tuning. A preset is data, so re-balancing every HARD level in the
/// game is one UPDATE and one publish, with no app release and no migration.
model DifficultyPreset {
  id   String @id @default(uuid(7)) @db.Uuid
  code Difficulty @unique

  timerEnabled Boolean @default(false)
  timerSeconds Int?

  heartsEnabled Boolean @default(false)
  startingHearts Int    @default(0)

  /// Share of normal XP paid on a failed attempt. Applied only once per level — see
  /// 08-difficulty/02. 0.5 for timeout by default; hearts configurable separately because
  /// running out of hearts is a different kind of failure from running out of time.
  timeoutXpMultiplier      Float @default(0.5)
  heartDepletionXpMultiplier Float @default(0.5)

  /// Board shaping. distractorCount is nearly free today — letterPool() already pads from a
  /// fixed bank and wordPool() already adds exactly two decoys; both become configurable.
  /// Frozen tiles and obstacles are NOT in this phase (see "Deliberately not here").
  extraDistractors Int @default(0)

  /// Powers a level permits at all. Null = all. An EXTREME level may forbid REVEAL without
  /// forbidding HINT.
  allowedPowers PowerType[] @default([])
  /// Cap on power uses in one attempt, across all types. Null = uncapped.
  maxPowerUsesPerAttempt Int?

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  levels Level[]

  @@map("difficulty_presets")
}

enum Difficulty { EASY  INTERMEDIATE  HARD  EXTREME }
```

`Level` gains the preset link plus one nullable override per tunable:

```prisma
model Level {
  // …existing fields unchanged…

  difficultyId String @db.Uuid
  difficulty   DifficultyPreset @relation(fields: [difficultyId], references: [id], onDelete: Restrict)

  /// Every override is nullable and means "inherit from the preset". A designer tunes one
  /// awkward level without forking a preset for it.
  timerEnabledOverride   Boolean?
  timerSecondsOverride   Int?
  heartsEnabledOverride  Boolean?
  startingHeartsOverride Int?
  extraDistractorsOverride Int?
  allowedPowersOverride  PowerType[] @default([])
}
```

Nullable-override columns rather than a single `configJson`: these values are queried
("show me every level with a timer under 30 seconds"), validated at publish, and diffed in
the delta. A JSON blob makes all three awkward and lets a typo ship.

## Preset seeds

Starting values, all tunable without a release:

| Preset         | Timer | Seconds | Hearts | Start | Distractors | Powers                        |
| -------------- | ----- | ------- | ------ | ----- | ----------- | ----------------------------- |
| `EASY`         | off   | —       | off    | 0     | 0           | all                           |
| `INTERMEDIATE` | on    | 75      | on     | 3     | +2          | all                           |
| `HARD`         | on    | 45      | on     | 3     | +4          | all except `REVEAL`           |
| `EXTREME`      | on    | 35      | on     | 2     | +6          | `HINT`, `UNDO`, `ADD_TIME` only |

Remember the first-clear rule: on `EXTREME`, a player's first pass is untimed with 2 hearts.
The 35-second timer is what they meet on the replay, when they already know the answer.

Every existing level defaults to `EASY`, which resolves to exactly today's behaviour. **The
50 levels currently in the pack change in no way** until a designer says otherwise — that
property is what makes this shippable behind a content change rather than a release.

## Delivery to the client

The resolved config rides in the existing level delta
([02-content/01](../02-content/01-level-pack-sync.md)) — no new endpoint, and it participates
in revision-based sync for free. A constraint retune is a content publish.

```jsonc
// GET /v1/levels?since=37 — each level gains:
{
  "number": 12, "chapter": 2, "revision": 41,
  "word": { … }, "sentence": { … },
  "constraints": {
    "difficulty": "HARD",
    "timerEnabled": true,
    "timerSeconds": 45,
    "heartsEnabled": true,
    "startingHearts": 3,
    "extraDistractors": 4,
    "allowedPowers": ["HINT", "SHUFFLE", "UNDO", "ADD_TIME", "FREEZE_TIME", "RESTORE_HEART"],
    "maxPowerUsesPerAttempt": null,
    "timeoutXpMultiplier": 0.5,
    "heartDepletionXpMultiplier": 0.5
  }
}
```

Fully resolved, per mode where it differs. The client stores it beside the level row in
SQLite and reads it when starting a board. A client that does not understand a field ignores
it, which is what lets a new constraint ship to old app versions harmlessly.

Constraints are **per level**, not per mode, in v1. A Word and a Sentence run on level 12
share the timer. If per-mode tuning is wanted later, the override columns become a small
`LevelModeConfig` child table — additive, and the wire shape above already nests under a
level rather than a mode, so the client change is contained.

## Publish-time validation

Rejected at publish, not discovered in play:

- `timerEnabled` with a null or non-positive `timerSeconds` after resolution.
- `timerSeconds` below the run validator's own floor for that answer length — a level nobody
  can physically finish (`tileCount × RUN_MIN_SECONDS_PER_TILE`, plus a 3× margin).
- `heartsEnabled` with `startingHearts` of 0 — that is "no hearts", and saying it two ways
  invites a level that ends on the first mistake by accident.
- `allowedPowers` containing a power that needs a timer on a level with no timer.

The third one is the kind of thing that ships and then produces a support ticket nobody can
reproduce.

## Deliberately not here

**Frozen tiles and obstacles.** The design lists them inside the difficulty presets, but they
are a different kind of thing: a timer constrains an existing board, a frozen tile is a new
board mechanic with its own rendering, interaction rules, solver implications and level
authoring. `extraDistractors` is in this phase because it is genuinely free — `letterPool()`
already pads from a fixed bank and `wordPool()` already adds two decoys, so the count is a
parameter that already exists in all but name. Frozen tiles and obstacles get their own
phase, and the preset table gains their columns then.

## Tasks

1. `DifficultyPreset`, `Difficulty` schema; `Level` gains `difficultyId` + override columns; migrate with every existing level defaulted to `EASY`.
2. `resolveConstraints(level, preset, progress)` — pure, shared shape, ported to the client.
3. Resolution at publish; `constraints` block in the manifest delta; publish-time validation.
4. `scripts/seed-difficulty.ts` with the four presets above.
5. Admin: preset CRUD + per-level overrides, behind the existing draft/publish flow.
6. Mobile: store `constraints` alongside the level row; apply the first-clear rule locally.
7. Tests: resolution precedence, the first-clear rule on both sides, every publish-validation rejection.

## Definition of done

- Re-balancing every HARD level is one row update and a publish.
- The 50 existing levels behave exactly as they do today.
- Client and server always agree on which constraints were in force for a given attempt.
- No level can be published that is impossible to complete.
