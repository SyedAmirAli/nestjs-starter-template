# 04.1 · Wallet — score, XP, points, Powers

**Goal:** four quantities, each with one owner, one meaning, and a ledger behind it.

## The four currencies and the walls between them

The mobile app's `src/game/rewards.ts` opens with an unusually clear statement of intent,
and the server's job is to enforce it rather than reinterpret it:

| Quantity   | Earned by                               | Spent on | Purpose                                        |
| ---------- | --------------------------------------- | -------- | ---------------------------------------------- |
| **Score**  | Solving levels; only the improvement over each level's previous best | **Nothing, ever** | The competitive stat. It is what a leaderboard rank means. |
| **XP**     | Every run, scaled by stars; replays pay a reduced rate under a daily cap | Nothing | Player level — a progression display, not a currency. |
| **Points** | Runs, quests, milestones, referrals (v2) | The shop | The soft currency. |
| **Powers** | Milestone grants (3 per 7 levels cleared, per track) and shop purchases | Used in-game: hint, reveal, shuffle | The consumable. |

Two walls, and neither may ever be crossed:

- **Score is not spendable.** The instant score buys anything, a rank stops meaning "played
  well" and starts meaning "chose not to spend". No endpoint may debit score.
- **Points do not buy score or XP.** `shop.tsx` already says it — "Points only. XP is never
  purchasable." A leaderboard with a purchasable input is not a leaderboard.

Powers sit between the two: purchasable with points, but never with score, and never
convertible back.

## Schema

```prisma
/// Balances only. Every balance here is the sum of a ledger, and is stored solely so a read
/// is one row instead of an aggregate. The ledgers are the truth; a drift check recomputes
/// this nightly.
model Wallet {
  id     String @id @default(uuid(7)) @db.Uuid
  userId String @unique

  /// Σ of best_score across level_progress. Recomputed, never incremented blindly.
  totalScore Int @default(0)

  xpTotal Int @default(0)
  points  Int @default(0)
  powers  Int @default(0)

  /// Milestones already settled, per track. What stops a replay paying a second time —
  /// the same guard the client's `wallet.word_milestones_paid` provides today.
  wordMilestonesPaid     Int @default(0)
  sentenceMilestonesPaid Int @default(0)

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@map("wallets")
}

/// One row per movement of a currency. Balances are derived from these; a balance that
/// cannot be explained by its ledger is a bug, and the nightly reconcile job says so.
model LedgerEntry {
  id     String @id @default(uuid(7)) @db.Uuid
  userId String

  currency Currency
  /// Signed. Credits positive, debits negative — so a balance is a plain SUM with no
  /// direction column to get backwards.
  amount   Int
  source   LedgerSource

  /// The run, purchase or quest that caused it. Untyped on purpose: this table must not
  /// grow a nullable FK per feature as features are added.
  subjectId String? @db.Uuid
  note      String?

  /// Balance immediately after this entry, for auditing without replaying the whole ledger.
  balanceAfter Int

  createdAt DateTime @default(now())

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, currency, createdAt])
  @@index([subjectId])
  @@map("ledger_entries")
}

enum Currency { SCORE  XP  POINTS  POWERS }

enum LedgerSource {
  RUN_COMPLETE
  RUN_REPLAY
  MILESTONE_GRANT
  QUEST_REWARD
  STREAK_REWARD
  SHOP_PURCHASE
  POWER_SPEND
  REFERRAL_REWARD     // v2, defined now so the enum is stable
  GUEST_MERGE
  ADMIN_ADJUST
}
```

`balanceAfter` is what turns "this player says they lost 200 points" from an investigation
into a single query.

## Player level from XP

```ts
/** Rises so later levels take longer, and caps so level 60 is not a second career. */
export const xpForLevel = (n: number): number => Math.min(300 + 60 * (n - 1), 1500);

export function levelFromXp(totalXp: number): { level, xpIntoLevel, xpForLevel } {
    let level = 1, remaining = totalXp;
    while (remaining >= xpForLevel(level)) { remaining -= xpForLevel(level); level++; }
    return { level, xpIntoLevel: remaining, xpForLevel: xpForLevel(level) };
}
```

Pure, in `src/modules/game/rewards/`, so the client can compute the same thing offline for
its optimistic render. The loop is bounded and cheap; do not cache it.

`mock.player` shows level 12 with 6,480 XP and 1,000 to the next level. Those numbers are
illustrative — the curve above is the real one, and the mock is replaced, not matched.

## Powers accounting

The balance is a pure function of the ledger, which is what makes
[guest merge](../01-identity/02-guest-merge.md) safe:

```
powers = Σ(MILESTONE_GRANT) + Σ(SHOP_PURCHASE) − Σ(POWER_SPEND) + Σ(ADMIN_ADJUST)
```

Milestone grants are settled by count, not by event. After each run the server recounts
distinct cleared levels for that track and compares against `wallet.<mode>MilestonesPaid`:

```
earned  = floor(distinctClearedLevels(mode) / 7)
unpaid  = max(0, earned − wallet.<mode>MilestonesPaid)
grant   = unpaid × 3
wallet.<mode>MilestonesPaid = earned
```

Identical in structure to `recordProgress()` in `mobile-app/src/db/levels.ts`, and identical
in effect: a replayed level can never pay a second milestone, and a player who skips around
still gets one grant per seven cleared levels.

## Spending Powers

Today the client tracks Powers in local component state (`useBoard.ts` starts every board at
`FRESH_POWERS = { hint: 3, reveal: 1, shuffle: 5 }` and decrements in memory) — so Powers
are effectively unlimited and reset every board. That is a placeholder, and making them
server-backed is the point of this module.

**Powers are spent optimistically on the device and reconciled at run submission.** Not a
synchronous debit: a `POST` in the middle of a board would put a spinner between tapping
"hint" and seeing the hint, over a network that may not be there.

So `powersUsed` in the run submission is the debit:

```
requested = hint + reveal + shuffle
debit     = min(requested, wallet.powers)
if (debit < requested) → record the run, flag `POWERS_OVERSPENT`, debit what existed
```

Clamping rather than rejecting is deliberate. The player already saw the hint; taking the
level back is a worse outcome than letting a rare desync cost the house three Powers. The
flag is what makes a *systematic* desync visible.

> **Superseded by [08-difficulty/03](../08-difficulty/03-power-architecture.md).** This
> section originally specified a **single integer Powers pool**, with "Hint ×5" granting five
> generic Powers. That was defensible with three interchangeable helpers; it is not once time
> and recovery powers exist, because a pool cannot express "you have 4 Powers but none of
> them are usable on this level". `Wallet.powers` is replaced by a typed `PowerInventory`
> table. Everything else in this document — the ledger, the milestone settlement rule, the
> optimistic-spend reasoning, the reconcile job — holds unchanged, applied **per power type**.

## Endpoints

### `GET /v1/economy/wallet`

```jsonc
{
  "totalScore": 1284,
  "points": 1254,
  "powers": 9,
  "xp": { "total": 6525, "level": 12, "intoLevel": 665, "forLevel": 1020 },
  "milestone": { "word":     { "levelsCompleted": 15, "levelsIntoMilestone": 1,
                               "levelsRemaining": 6, "targetLevelCount": 21, "pct": 14.28 },
                 "sentence": { … } }
}
```

`Cache-Control: private, no-store`. A stale wallet is a support ticket.

### `GET /v1/economy/ledger?currency=POINTS&cursor=&limit=25`

Cursor-paginated history. Powers the "where did my points go" screen, which does not exist
yet but will the first week after launch.

```jsonc
{ "items": [ { "id": "…", "currency": "POINTS", "amount": -250,
               "source": "SHOP_PURCHASE", "note": "Hint ×5",
               "balanceAfter": 1004, "createdAt": "…" } ],
  "nextCursor": "eyJj…" }
```

### `POST /v1/admin/economy/adjust` — `ADMIN` only

Grant or revoke, with a mandatory reason, writing both an `ADMIN_ADJUST` ledger row and an
`AuditLog` row. Support needs this on day one; building it later means the first refund is
done with `psql`.

## Reconciliation

A nightly job recomputes every balance from its ledger and from `level_progress`, and
reports drift. Drift is not silently corrected — it is reported, because a wallet that
silently changes overnight is indistinguishable from theft from the player's side. Only
`totalScore` is auto-corrected, since it is *defined* as `SUM(best_score)` and has no
independent existence.

## Tasks

1. `Wallet`, `LedgerEntry`, `Currency`, `LedgerSource` schema; migrate.
2. Seed a `Wallet` in `user.create.after` alongside `UserMeta` and `PlayerProfile`.
3. `EconomyService` — `credit()`, `debit()`, `balances()`, all transaction-scoped so run submission composes them in one commit.
4. `levelFromXp` / `xpForLevel` in `rewards/`, exported for the client to mirror.
5. Wallet + ledger endpoints; admin adjust with audit.
6. Nightly reconcile job with a drift report.
7. Mobile: replace `useBoard.ts`'s `FRESH_POWERS` with the server balance; spend optimistically.
8. e2e: 21 levels → exactly 9 Powers; replay them all → still 9.

## Definition of done

- Every balance equals the sum of its ledger.
- No endpoint debits `SCORE`.
- No path converts points or Powers into XP or score.
- Milestone Powers are paid exactly once per seven distinct cleared levels, per track,
  under any order of play, replay or merge.
