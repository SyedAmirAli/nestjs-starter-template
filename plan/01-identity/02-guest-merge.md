# 01.2 · Guest → member merge

**Goal:** when a guest signs up, everything they earned comes with them — and nothing they
earned can be earned twice.

## The two failure modes

This feature has exactly two ways to go wrong, and they pull in opposite directions:

1. **Losing progress.** A player who cleared 30 levels as a guest, then signed in, and
   found level 1 waiting for them will uninstall. This is the failure everyone anticipates.
2. **Duplicating progress.** A player who works out that "play as guest → earn 3 Powers →
   sign in → repeat" mints currency will do it, and so will everyone they tell. This is the
   failure that is easy to ship without noticing.

The merge rules below are chosen so that every quantity is **either idempotent under merge
or derived from a set union**, never summed from two balances.

## When it runs

Better Auth's `anonymous()` plugin fires `onLinkAccount({ anonymousUser, newUser })` after
a successful link. That handler enqueues `QueueName.GuestMerge` and returns immediately —
the merge must not sit inside the sign-in request. Sign-in has to stay fast and must not
fail because a merge failed.

The client polls `GET /v1/players/me/merge-status` (or simply refetches `/v1/progress`)
until `state` is `DONE`. Typical duration is well under a second; the async shape is about
isolation, not latency.

```
MergeJob(fromUserId, toUserId)
  → single Prisma transaction
  → audit row (action: OTHER, resource: 'account.merge')
  → mark PlayerProfile.mergeState = DONE
  → delete the anonymous user row (cascades everything left behind)
```

The whole merge is **one transaction**. A partially merged account is worse than an
unmerged one, because it is invisible.

## The rules, quantity by quantity

### Level progress — max/min per (level, mode)

```
stars            = max(a, b)
bestTimeMs       = min(a, b)          -- null-safe: a null loses to any number
bestScore        = max(a, b)
completedAt      = min(a, b)          -- earliest, so "first cleared" stays true
attempts         = a + b              -- a count of events, genuinely additive
```

Idempotent: merging the same pair twice changes nothing. This is a set reconciliation, not
an accumulation.

### Score — recomputed, never summed

`totalScore` is **defined** as the sum of every level's best score
(`mobile-app/src/game/rewards.ts` `scoreGain()` enforces exactly this: a replay banks only
its improvement over the level's previous best). So after merging `level_progress`:

```sql
totalScore = SELECT COALESCE(SUM(best_score), 0) FROM level_progress WHERE user_id = :to
```

Recomputing from the merged set makes double-counting structurally impossible. Do not add
the two wallets' `totalScore` values.

### XP and points — summed, from the ledger

XP and points are event streams, not derived aggregates. Merge is a re-parenting of ledger
rows:

```sql
UPDATE xp_ledger    SET user_id = :to WHERE user_id = :from;
UPDATE point_ledger SET user_id = :to WHERE user_id = :from;
```

Then recompute the wallet balances by summing the merged ledgers. Farming XP by looping
guest accounts requires actually playing the levels, which is not an exploit — it is the
game.

### Powers — recomputed grants, summed purchases

This is the one that needs care, because Powers are the exploitable currency.

The Powers ledger distinguishes sources:

| `source`             | Merge treatment                                                                |
| -------------------- | ------------------------------------------------------------------------------ |
| `MILESTONE_GRANT`    | **Discarded and recomputed** from the merged level count.                       |
| `PURCHASE`           | Re-parented and summed — points were genuinely spent.                           |
| `SPEND`              | Re-parented and summed — the Powers were genuinely used.                        |
| `ADMIN_ADJUST`       | Re-parented and summed.                                                         |

Milestone grants pay `POWERS_PER_MILESTONE = 3` every `LEVELS_PER_MILESTONE = 7` cleared
levels, **per track**. Recomputing them from the merged count is what closes the loop: a
player who cleared 7 levels as a guest and 7 as a member has cleared 14 levels, and
`floor(14 / 7) * 3 = 6` Powers — not `3 + 3 = 6` by coincidence, but 6 by definition, and
still 6 if they merge a third account that overlaps the first two entirely.

```
milestonePowers(to) = Σ over mode of floor(distinctClearedLevels(to, mode) / 7) * 3
balance             = milestonePowers(to) + Σ(purchases) − Σ(spends) + Σ(adjustments)
```

If the recomputed balance is **lower** than what the member already held (possible only
through overlapping level sets), clamp at the existing balance and write an
`ADMIN_ADJUST` row for the difference. Never take Powers away from someone during a
sign-up. Losing three Powers on the day you create an account is a support ticket; the
audit row is how it gets answered.

### Streak and activity — union of days

```
daily_activity: UPSERT per (userId, localDate), summing minutes / levels / xp
currentStreak:  RECOMPUTED from the merged day set, not copied
longestStreak:  max(a, b, recomputed)
freezes:        max(a, b)     -- not summed; freezes are a small consumable
```

Union, then recompute. A guest and a member who played the same 10 days do not get a
20-day streak.

### Profile — member wins, guest fills gaps

The member account is the surviving identity. Its `displayName`, `country`, `avatar`,
`ageBand` and language selections win. Any field that is **null on the member and set on
the guest** is copied over — a guest who completed onboarding and then signed in should not
be asked their country twice.

### Saved runs — copied only where absent

An in-progress board on the guest account is copied only for `(levelId, mode)` pairs the
member has no saved run for. Two half-finished boards for the same level cannot be
reconciled; the member's own is the one they were last looking at.

## Endpoints

| Method | Path                            | Auth | Purpose                                            |
| ------ | ------------------------------- | ---- | -------------------------------------------------- |
| `GET`  | `/v1/players/me/merge-status`   | any  | `{ state, startedAt, finishedAt, summary }`         |

```jsonc
// 200
{
  "state": "DONE",                       // NONE | PENDING | RUNNING | DONE | FAILED
  "startedAt": "2026-08-19T09:14:02.113Z",
  "finishedAt": "2026-08-19T09:14:02.640Z",
  "summary": { "levelsMerged": 31, "xpGained": 1840, "pointsGained": 260,
               "powersReconciled": 0, "daysMerged": 14 }
}
```

`summary` exists so the app can show "We brought over 31 levels and 1,840 XP" instead of a
silent transition. That screen is worth building — it is the moment a player learns that
signing in was worth it.

## Failure and recovery

- **Merge job fails.** `mergeState = FAILED`, the anonymous user is **not** deleted, the
  job dead-letters to `identity.guest-merge.dead`. The data is still there and the merge can
  be re-run by hand. Never delete the source before the transaction commits.
- **Merge runs twice.** Guarded by `PlayerProfile.mergeState` plus the fact that every rule
  above is idempotent. The second run is a no-op.
- **The member account already has more progress.** Fine — every rule is a max/union. The
  member simply keeps what they had.

## Tasks

1. `MergeService.merge(fromUserId, toUserId)` — one transaction, rules above.
2. `GuestMergeWorker extends BaseWorker` on `QueueName.GuestMerge`.
3. `PlayerProfile.mergeState` enum column + `merge-status` endpoint.
4. Audit row on every merge, with the full `summary` in `metaJson`.
5. Unit tests per rule; the critical one is **merge-twice-is-a-no-op** for every quantity.
6. e2e: guest plays 8 levels (crossing a milestone) → signs in → balances are exactly right,
   and running the merge again changes nothing.

## Definition of done

- Merging an account into itself, or twice, produces byte-identical state.
- No sequence of guest-account creation and merging can produce Powers, XP or score that
  playing the same levels once on one account would not.
- A failed merge loses nothing.
