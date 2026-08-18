# 08.2 · Attempt lifecycle — failure, XP, and restart

**Goal:** make failure a real, recorded outcome that costs nothing permanent, pays a
consolation exactly once, and cannot be farmed.

## An attempt is now a first-class thing

Until now a run was only ever a *solve* — `useBoard.ts` has no concept of failing, only of
shaking and clearing. Timers and hearts introduce ending an attempt without solving it, and
that has to be a recorded outcome rather than a client-side non-event: it feeds consolation
XP, activity time, streaks, and every anti-cheat signal.

```prisma
enum AttemptOutcome {
  SOLVED
  TIMEOUT            // the countdown reached zero
  HEARTS_DEPLETED    // the last heart was lost
  ABANDONED          // the player left; recorded, pays nothing
}
```

`Run` gains:

```prisma
model Run {
  // …existing fields unchanged…

  outcome AttemptOutcome @default(SOLVED)

  heartsStarted   Int  @default(0)
  heartsRemaining Int  @default(0)

  /// Milliseconds added by time powers during this attempt. The server needs it to
  /// validate elapsedMs against the level's limit.
  timeGrantedMs Int @default(0)

  /// The constraints actually in force, snapshotted. Same discipline as `chapter` on a run
  /// and `pricePaid` on a purchase: retuning a preset must never change what a past attempt
  /// was worth or whether it was valid.
  constraintSnapshot Json

  /// True when a PURCHASED time or recovery power was consumed. Such a run pays full XP and
  /// progression but contributes nothing to leaderboard score — see 06-leaderboards.
  usedPurchasedAid Boolean @default(false)
}
```

`isPersonalBest`, `stars`, `score` and `scoreGained` are all `0`/`false` on any non-`SOLVED`
outcome. A failed attempt is not a performance.

## Consolation XP — once per level, ever

The design asks for 50% XP on timeout with an automatic restart. Taken literally that is an
infinite faucet: on a 45-second timer, doing nothing pays ~50 XP every 45 seconds, forever,
which out-earns playing. The design already flags the risk ("do not accidentally award XP
multiple times for repeated failed attempts") without naming a mechanism; this is the
mechanism.

**A failure pays XP only if the player has never cleared that level in that mode, and has
not already been paid a consolation for it.**

```
payConsolation =
      progress.firstClearedAt   is null
  &&  progress.consolationPaidAt is null
  &&  outcome in (TIMEOUT, HEARTS_DEPLETED)

xp = payConsolation
   ? round(baseXp(level, mode) × (outcome === TIMEOUT
        ? constraints.timeoutXpMultiplier
        : constraints.heartDepletionXpMultiplier))
   : 0
```

`LevelProgress` gains `consolationPaidAt DateTime?`, set in the same transaction that pays
it. One extra nullable column closes the exploit completely.

This keeps what the design actually wanted — the first sting of failing a new level is
softened, and the player sees they got *something* — while making the second, third and
thousandth failure worth nothing. It also composes with the existing replay rules
(`REPLAY_XP_RATE`, the daily cap) instead of fighting them, because a level you have cleared
pays no consolation at all and is governed purely by the replay path.

### What a failed attempt does and does not do

| Effect                                  | On failure                                          |
| --------------------------------------- | ---------------------------------------------------- |
| XP                                      | Consolation, once per level, ever. Otherwise 0.      |
| Score                                   | **Never.** Score is a solve-time measure.            |
| Points                                  | Never.                                               |
| Stars                                   | Never; `LevelProgress.stars` is untouched.           |
| Best time / best score                  | Untouched.                                           |
| `attempts`                              | Incremented — it is an attempt.                      |
| Milestone credit                        | No. Milestones count *cleared* levels.               |
| Streak / `DailyActivity.activeSeconds`  | **Yes.** The player played. A day spent losing is still a day played, and breaking someone's streak for trying is the exact opposite of the stated design principle. |
| Quest `PLAY_MINUTES`                    | Yes — real minutes.                                  |
| Quest `COMPLETE_LEVELS` / `NEW_LEVELS` / `PERFECT_RUNS` | No.                                  |
| Powers consumed                         | Yes. They were used.                                 |

That streak row is a deliberate kindness and worth defending: a struggling player is the one
most likely to lose a streak, and the one for whom losing it is most likely to end their
relationship with the app.

## Submission

`POST /v1/runs` takes the same shape with four added fields:

```jsonc
{
  "clientRunId": "0192f3a1-…",
  "levelNumber": 12,
  "mode": "word",
  "outcome": "TIMEOUT",                       // SOLVED | TIMEOUT | HEARTS_DEPLETED | ABANDONED
  "elapsedMs": 45000,
  "heartsRemaining": 1,
  "timeGrantedMs": 10000,
  "powersUsed": { "HINT": 1, "ADD_TIME": 1 },  // typed — see 08.3
  "startedAt": "2026-08-19T09:12:03.000Z",
  "finishedAt": "2026-08-19T09:12:48.000Z"
}
```

Response gains an `attempt` block; everything else is unchanged:

```jsonc
"attempt": {
  "outcome": "TIMEOUT",
  "xpGained": 15,
  "consolation": true,
  "consolationRemaining": false,   // there will not be another for this level
  "heartsRemaining": 1,
  "restart": { "hearts": 3, "timerSeconds": 45 }   // the config for the next attempt
}
```

`restart` is sent because the client is about to restart immediately and the constraints for
the next attempt may differ from the last — most obviously the moment a player's first clear
turns the timer on.

`ABANDONED` runs are submitted **batched, not immediately**, on the next sync. They pay
nothing and exist only as an anti-cheat and analytics signal; sending one the instant a
player backs out of a level would double this endpoint's traffic for no player-visible value.

## Validation gets stronger, not weaker

Timers are a gift to the server-authoritative model. Previously the server could only say
"32 seconds is plausible for a six-letter word". Now, when a level declares
`timerSeconds: 45`, the ceiling is arithmetic:

```
elapsedMs <= (constraints.timerSeconds × 1000) + timeGrantedMs + GRACE_MS   // GRACE_MS = 2000
```

New hard rejections (`422 RUN_IMPLAUSIBLE`):

| Check                              | Rule                                                                    |
| ---------------------------------- | ------------------------------------------------------------------------ |
| Timed run exceeded its limit       | The inequality above, with `outcome: SOLVED`.                            |
| `timeGrantedMs` unaffordable       | Exceeds what the player's `ADD_TIME` inventory could have granted.       |
| Timeout that did not reach zero    | `outcome: TIMEOUT` with `elapsedMs` well under the limit.                |
| Hearts arithmetic                  | `heartsRemaining` outside `0 … heartsStarted`; `HEARTS_DEPLETED` with `heartsRemaining > 0`. |
| Constraint mismatch                | Claimed constraints disagree with the server's resolution for that level and player. |
| Powers not permitted               | A power outside `allowedPowers`, or more uses than `maxPowerUsesPerAttempt`. |

The constraint-mismatch check is the important one, and it is why
`resolveConstraints()` must be one shared rule: the server recomputes the constraints from
the level and the player's own progress and compares them against the snapshot the client
sent. A patched client claiming "this level had no timer" is caught by arithmetic rather
than by heuristics.

**Failed attempts now count against the rate limit**, and auto-restart makes them frequent.
Raise `POST /v1/runs` from 60 to **120 per 5 minutes**; a player repeatedly failing a
30-second level legitimately produces ~10 per 5 minutes, so the headroom stays large.

## Stars on timed levels

`STAR_THRESHOLDS` is absolute (3★ ≤ 15s word, ≤ 25s sentence). On a level with a 30-second
timer that is nearly meaningless — 3★ and the failure boundary sit almost on top of each
other.

So stars key off whichever measure the level actually has:

```
untimed → today's absolute thresholds, unchanged
timed   → fraction of the limit remaining at solve:
            >= 50% remaining → 3 stars
            >= 20% remaining → 2 stars
            otherwise        → 1 star
```

Because timers only appear on levels the player has already cleared, **every first clear
still uses the absolute thresholds** and today's star behaviour is untouched. The relative
scale exists only where a limit exists to be relative to.

Both branches go in the shared `rewards/` module and both are covered by the parity fixture.

## Restart

Restart is a **board reset, not a navigation event**. `useBoard.ts` already has `reset()`;
the failure path calls it after the result overlay dismisses. The player never returns to
the map, which is the difference between a retry and a punishment.

| Reset                              | Preserved                                     |
| ---------------------------------- | --------------------------------------------- |
| Slots, tile order, hint state      | Player profile, XP, points                    |
| Timer (to the resolved limit)      | Permanent power inventory                     |
| Hearts (to `startingHearts`)       | Level unlock status                           |
| Powers *used during this attempt*  | Best time, best stars, best score             |
| `clientRunId` (a new attempt)      | Streak, quests, daily activity                |

Powers consumed in a failed attempt are **spent** — they are not refunded on restart. A
refund would make `RESTORE_HEART` free on any attempt you were going to lose anyway, which
is every attempt you would use it on.

The saved-run row for that level is **cleared** on any terminal outcome. A timed-out board is
not a board worth resuming, and offering it back would restore a state whose timer had
already expired.

## Tasks

1. `AttemptOutcome`; `Run` gains outcome, hearts, `timeGrantedMs`, `constraintSnapshot`, `usedPurchasedAid`; `LevelProgress.consolationPaidAt`; migrate.
2. Consolation rule in `RunService.submit()`, inside the existing transaction.
3. Non-`SOLVED` short-circuit: no score, points, stars, bests or milestone credit; activity and streak still recorded.
4. `RunValidator` gains the six checks above; `resolveConstraints()` shared with the client.
5. Timed star branch in `rewards/`; extend the parity fixture to cover it.
6. Rate limit 60 → 120 per 5 minutes.
7. Batched `ABANDONED` submission on sync.
8. Tests: consolation paid exactly once across 100 deliberate timeouts; a failure extends a streak; a solve over the limit is rejected; a timeout at 10% elapsed is rejected.

## Definition of done

- Deliberately failing a level 100 times pays XP exactly once and score never.
- A failed attempt keeps a streak alive.
- A run cannot claim constraints the server would not have resolved for that player.
- Restart never leaves the gameplay screen.
