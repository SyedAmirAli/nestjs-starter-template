# 08.3 · Power architecture

**Goal:** a typed, data-driven power system where adding "Slow Timer" is a database row and
one effect handler — not a change to the timer, the board, the wallet or the shop.

## This supersedes the single-pool decision

[04-economy/01](../04-economy/01-wallet.md) originally specified **one integer Powers
balance**, with the shop's "Hint ×5" granting five generic Powers. That was defensible with
three interchangeable helpers. It is not defensible now:

- The shop already names powers individually ("Hint ×5", "Reveal ×3", "Shuffle ×10"), so a
  single pool made those labels lies.
- Time powers must be **unavailable on untimed levels**, and recovery powers on
  heartless levels. A pool cannot express "you have 4 Powers but none of them are usable
  here".
- `allowedPowers` per difficulty preset needs a type to allow or forbid.

So: **typed inventory**. `Wallet.powers` is removed; `PowerInventory` replaces it.

## Definitions are data

```prisma
/// One row per power. Adding a power is an INSERT plus a client effect handler registered
/// under the same code — no schema change, no shop change, no wallet change.
model PowerDefinition {
  id   String    @id @default(uuid(7)) @db.Uuid
  code PowerType @unique

  name    String        // "Add Time"
  blurb   String        // "Adds 10 seconds to the clock."
  iconKey String        // asset key in the client registry

  category PowerCategory

  /// Effect parameters, shape determined by category. { "seconds": 10 } for ADD_TIME,
  /// { "hearts": 1 } for RESTORE_HEART, { "durationMs": 5000 } for FREEZE_TIME.
  /// Untyped on purpose: a typed column per parameter is a migration per power.
  params Json

  /// Availability gates. An ADD_TIME power on an untimed level is not merely useless — it
  /// must not be offered, or the player spends it on nothing.
  requiresTimer  Boolean @default(false)
  requiresHearts Boolean @default(false)

  /// Uses of THIS power permitted in one attempt. Null = unlimited (subject to inventory
  /// and the level's own maxPowerUsesPerAttempt).
  maxPerAttempt Int?
  /// Seconds before the same power may be used again in one attempt. Stops a player
  /// stacking four +10s in one tap-storm at 00:01.
  cooldownSeconds Int @default(0)

  isActive  Boolean  @default(true)
  sortOrder Int      @default(0)

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@map("power_definitions")
}

enum PowerCategory { HINT  TIME  RECOVERY  PUZZLE }

enum PowerType {
  // HINT
  HINT            // glow the next correct tile
  REVEAL          // place the next correct tile
  ELIMINATE       // remove two wrong tiles from the bank
  // TIME
  ADD_TIME
  FREEZE_TIME
  SLOW_TIME
  // RECOVERY
  RESTORE_HEART
  SHIELD          // absorb the next wrong attempt without costing a heart
  // PUZZLE
  SHUFFLE
  UNDO
}

model PowerInventory {
  id     String @id @default(uuid(7)) @db.Uuid
  userId String

  power    PowerType
  quantity Int @default(0)

  updatedAt DateTime @updatedAt

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([userId, power])
  @@index([userId])
  @@map("power_inventory")
}
```

`LedgerEntry` gains a nullable `power PowerType?` so a `POWERS` movement says which one.
Every existing rule from [04-economy/01](../04-economy/01-wallet.md) still holds per type:
balance is the sum of its ledger, and the nightly reconcile verifies it.

## Seeds

| Power           | Category | Params                 | Timer? | Hearts? | Per attempt | Cooldown |
| --------------- | -------- | ---------------------- | ------ | ------- | ----------- | -------- |
| `HINT`          | HINT     | `{ "glowMs": 2600 }`   | —      | —       | 3           | 3s       |
| `REVEAL`        | HINT     | `{ "tiles": 1 }`       | —      | —       | 2           | 2s       |
| `ELIMINATE`     | HINT     | `{ "tiles": 2 }`       | —      | —       | 1           | —        |
| `ADD_TIME`      | TIME     | `{ "seconds": 10 }`    | **yes**| —       | 3           | 5s       |
| `FREEZE_TIME`   | TIME     | `{ "durationMs": 8000 }`| **yes**| —      | 1           | —        |
| `SLOW_TIME`     | TIME     | `{ "rate": 0.5, "durationMs": 15000 }` | **yes** | — | 1 | — |
| `RESTORE_HEART` | RECOVERY | `{ "hearts": 1 }`      | —      | **yes** | 2           | —        |
| `SHIELD`        | RECOVERY | `{ "attempts": 1 }`    | —      | **yes** | 1           | —        |
| `SHUFFLE`       | PUZZLE   | `{}`                   | —      | —       | —           | 1s       |
| `UNDO`          | PUZZLE   | `{ "scope": "TILE" }`  | —      | —       | —           | —        |

`ADD_TIME`'s magnitude is a param, so "+10s" becomes "+15s" by editing a row. The design
asks for +10 / +15 / +20 as balance-dependent; this is how that stays balance-dependent.

`cooldownSeconds` on `ADD_TIME` matters more than it looks: without it, a player at 00:01
taps three extensions in one second and the "clearly show the additional time" feedback the
design asks for has nowhere to land.

## Undo, and the free-undo problem

**`useBoard.ts` already has a free, unlimited `undo()`.** Making Undo a paid power is a
*removal* from the current experience, and players notice removals far more than they notice
additions.

So the scope splits:

| Action                                   | Cost                                              |
| ---------------------------------------- | ------------------------------------------------- |
| Remove the last-placed tile, mid-attempt | **Free, unlimited** — exactly as today            |
| Undo a *wrong attempt* (restore the board and refund the heart it cost) | `UNDO` power |

The first is board manipulation and was never a power. The second is what the design is
actually reaching for — "the player selected A → P → X but X was wrong" is only a
consequential mistake once hearts exist, and undoing a consequence is what deserves a price.

`params.scope` (`TILE` | `WORD` | `ATTEMPT`) keeps the design's "configurable undo scope"
requirement without needing three powers.

## Extensibility: how a new time power gets added

This is the design's explicit requirement — *"design the architecture so new time powers can
be added later without rewriting the timer system"* — and it is satisfied by making the
timer a **command surface**, not a counter.

```ts
// The complete public surface of the timer. Every present and future time power is
// expressible as a sequence of these; none of them may reach inside the timer's state.
interface TimerController {
  addMs(ms: number): void;
  freeze(durationMs: number): void;
  setRate(rate: number, durationMs: number): void;   // SLOW_TIME = setRate(0.5, 15000)
  remainingMs(): number;
  subscribe(fn: (remainingMs: number, phase: TimerPhase) => void): () => void;
}
type TimerPhase = 'NORMAL' | 'WARNING' | 'CRITICAL' | 'EXPIRED';
```

A power is then a handler registered by code:

```ts
registerPower('ADD_TIME', (ctx, params) => {
  ctx.timer.addMs(params.seconds * 1000);
  ctx.feedback.burst('time-added', `+${params.seconds}s`);
});
```

Adding `RESTORE_TIME` ("reset the clock to full") is one `registerPower` call against
`addMs`. Nothing in the timer changes. That is the test the design asked for, and the
architecture passes it.

### The timer must be deadline-based, not tick-accumulating

`useBoard.ts` currently counts up with `setInterval(() => setElapsed(t => t + 1), 1000)`.
That cannot be the timer:

- `setInterval` does not run reliably when the app is backgrounded, so a player who takes a
  call gets free time — or, worse, inconsistent time across platforms.
- Accumulated ticks drift.
- `addMs` against an accumulator is a race with the tick.

Instead store `deadlineAt` and derive `remainingMs = deadlineAt - now`, with the interval
used only to drive rendering. Then `addMs` is `deadlineAt += ms`, `freeze` records a paused
span, and returning from background recomputes truthfully. It also means the timer survives
a JS thread stall, which the accumulator does not.

The existing `paused` prop on `useBoard` (which the pause sheet already uses) becomes the
same mechanism `FREEZE_TIME` uses. That hook already exists and is the right one.

## Availability

A power is offered only when **all** hold — computed once, in one place, and used by both the
HUD and the server validator:

```
definition.isActive
  && quantity > 0
  && (!definition.requiresTimer  || constraints.timerEnabled)
  && (!definition.requiresHearts || constraints.heartsEnabled)
  && (constraints.allowedPowers is empty || power ∈ constraints.allowedPowers)
  && usesThisAttempt < min(definition.maxPerAttempt, constraints.maxPowerUsesPerAttempt)
  && cooldown elapsed
```

Unavailable powers are **hidden, not disabled-and-greyed**, when the reason is structural
(no timer on this level). A grey `+10s` on an untimed level is a question the player has to
answer for themselves. Powers unavailable because the *balance* is zero stay visible with a
buy affordance — that one is a purchase prompt, not noise.

## Earning and spending

**Milestone grants** — still 3 Powers per 7 cleared levels per track, but now typed. The
bundle is configurable on the preset; default `{ HINT: 1, UNDO: 1, ADD_TIME: 1 }`. Total
unchanged, so the economy's pacing is untouched.

**Shop** — every item's `grants` JSON becomes typed and the existing labels stop lying:

```jsonc
{ "code": "POWER_HINT_5",  "title": "Hint ×5",  "grants": { "HINT": 5 } }
{ "code": "POWER_TIME_3",  "title": "+10s ×3",  "grants": { "ADD_TIME": 3 } }
{ "code": "POWER_BUNDLE",  "title": "All ×5",   "grants": { "HINT": 5, "REVEAL": 5, "SHUFFLE": 5, "UNDO": 5, "ADD_TIME": 5 } }
```

**Spending** stays optimistic-on-device, reconciled at submission — the reasoning in
[04-economy/01](../04-economy/01-wallet.md) is unchanged and still right: a network round-trip
between tapping "hint" and seeing the hint is unacceptable over a connection that may not
exist. `powersUsed` becomes a typed map, and over-spend is clamped per type with the same
`POWERS_OVERSPENT` flag.

## The leaderboard wall

The economy has a wall: **points must not buy score.** `HINT` and `REVEAL` only bent it —
they cost time, and time is score, so using them was self-limiting.

`ADD_TIME`, `RESTORE_HEART` and `SHIELD` break it properly. They convert a *failed* attempt
into a *completed* one, and completion is score, and score is rank. The chain becomes:
buy points → buy recovery powers → clear hard levels → climb.

Fix, and it is cheap: an attempt that consumed a **purchased** time or recovery power sets
`Run.usedPurchasedAid = true`, and such a run contributes **nothing to leaderboard score**.
It still pays full XP, points, stars, progression and milestone credit — everything the
player experiences as progress is untouched. Only rank is protected.

Powers granted by milestones do not set the flag. They were earned by playing, which is
precisely the distinction the wall exists to draw.

## Endpoints

| Method | Path                    | Auth | Purpose                                                     |
| ------ | ----------------------- | ---- | ----------------------------------------------------------- |
| `GET`  | `/v1/powers`            | any  | Definitions + the player's quantities, in one read           |
| `GET`  | `/v1/powers/catalog`    | public | Definitions only; cached and ETag'd with the level pack    |

```jsonc
// GET /v1/powers
{
  "powers": [
    { "code": "ADD_TIME", "name": "Add Time", "blurb": "Adds 10 seconds to the clock.",
      "iconKey": "power.power-add-time", "category": "TIME",
      "params": { "seconds": 10 }, "requiresTimer": true, "requiresHearts": false,
      "maxPerAttempt": 3, "cooldownSeconds": 5, "quantity": 2 }
  ]
}
```

One read fills the powers sheet, the HUD and the shop's affordability display.

## Tasks

1. `PowerType`, `PowerCategory`, `PowerDefinition`, `PowerInventory` schema; `LedgerEntry.power`; **drop `Wallet.powers`**; migrate, converting any existing pooled balance into `HINT`.
2. `scripts/seed-powers.ts` with the ten definitions above.
3. `PowerService` — availability resolution, typed credit/debit, per-attempt and cooldown enforcement.
4. Typed `powersUsed` in run submission; per-type clamping; `usedPurchasedAid` derivation.
5. Update milestone grants and every shop `grants` payload to typed maps.
6. Leaderboard scoring excludes `usedPurchasedAid` runs.
7. Mobile: `TimerController` (deadline-based), the power registry, free tile-undo retained.
8. Tests: availability matrix across all four level modes; cooldown and per-attempt caps; a purchased `ADD_TIME` solve pays XP but moves no rank.

## Definition of done

- Adding a new time power is one seed row plus one `registerPower` call, with no change to the timer, wallet, shop or run submission.
- No time power is offered on an untimed level, and no recovery power on a heartless one.
- Free tile-undo still works exactly as it does today.
- Buying points cannot move a player up a leaderboard.
