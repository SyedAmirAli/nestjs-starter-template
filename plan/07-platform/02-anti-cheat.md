# 07.2 · Anti-cheat and observability

**Goal:** keep the leaderboard honest without ever telling a fast, honest player they are a
cheat.

## The threat, stated plainly

The client is a React Native app on a device the player controls. Its JavaScript bundle can
be read, patched and replayed. Anyone sufficiently motivated **can** send an arbitrary
`POST /v1/runs`. So the goal is not prevention — that is not available — it is:

1. Make the cheap attacks impossible (send your own score).
2. Make the remaining attacks detectable and reversible.
3. Never punish a false positive automatically.

Point 3 is the one that gets skipped. A player who solves "CAT" in four seconds because they
have played it eleven times is exactly what the star thresholds reward
(`STAR_THRESHOLDS.word.three = 15s`), and an automated ban for that is a worse outcome than
a cheater on a leaderboard.

## Layer 1 — the reward is not in the request

Already achieved by [03-gameplay/01](../03-gameplay/01-run-submission.md): the DTO accepts
`levelNumber`, `mode`, `elapsedMs`, `powersUsed`, timestamps and `clientRunId`. Nothing
else. `forbidNonWhitelisted` makes a `score` field a 400, not a silent drop.

This single decision eliminates the entire class of "edit the number" attacks. What remains
is lying about `elapsedMs`, which is a much smaller surface.

## Layer 2 — plausibility

Hard rejection (`422 RUN_IMPLAUSIBLE`) for the physically impossible only:

```
elapsedMs >= tileCount × RUN_MIN_SECONDS_PER_TILE × 1000
elapsedMs <= 2h
|((finishedAt − startedAt) − elapsedMs)| <= 5s
finishedAt <= now + 5min          (clock skew)
hint + reveal + shuffle <= 20  and  reveal <= tileCount
level exists and is not retired
```

At 0.35 s/tile, a six-letter word cannot be solved in under 2.1 seconds. That threshold is
set from the physical floor of six deliberate taps, not from observed play — it must sit
below the fastest human, not near the median.

## Layer 3 — behavioural flags

Recorded on the run (`flaggedReason`), never rejected. The nightly
`maintenance.anomaly-scan` job also flags **accounts**:

| Signal                                                        | What it suggests                        |
| ------------------------------------------------------------- | --------------------------------------- |
| Every run in 24h at 3★ with times under 2× the minimum        | Scripted solving                        |
| > 200 runs in one hour                                        | Automation                              |
| Score gained per hour above the 99.9th percentile             | Something is wrong somewhere            |
| `receivedAt − finishedAt` > 30 days from an otherwise-online device | Backdated payloads                 |
| Powers spent that the wallet never held, repeatedly            | Patched client                          |
| Client-predicted vs server-computed reward mismatch, repeatedly | A patched client — or drifted rules     |
| Many accounts, one IP, one device fingerprint, all merging     | Guest-merge farming                     |

That last-but-one row is the valuable one, and it cuts both ways. The client sends its
prediction in an `X-Client-Predicted-Score` header (advisory, never stored as a value). A
mismatch on one device is a patched client; a mismatch across thousands of devices after a
release means **the two implementations of `rewards.ts` have drifted** and the server is
wrong. Alert on the aggregate rate, not the individual event.

## Layer 4 — consequences, graded

| State        | Set by                       | Effect                                                                |
| ------------ | ---------------------------- | --------------------------------------------------------------------- |
| `CLEAN`      | default                      | Nothing.                                                              |
| `WATCHED`    | anomaly scan                 | Nothing visible. Runs are retained for review.                        |
| `SHADOWED`   | operator                     | Excluded from leaderboards. Play, progress and rewards all continue normally. |
| `SUSPENDED`  | operator                     | `User.isActive = false`. Existing sessions are purged by the Better Auth `session.create.before` gate. |

Only the scan sets `WATCHED`. **Every state beyond it is a human decision**, taken through an
admin endpoint, with a reason, writing an `AuditLog` row.

`SHADOWED` is the useful one. A cheater who is removed from the board and told nothing does
not iterate on their exploit; a cheater who gets an error message tests until they find what
triggered it.

```prisma
model PlayerIntegrity {
  id     String @id @default(uuid(7)) @db.Uuid
  userId String @unique

  state IntegrityState @default(CLEAN)
  /// Machine-readable signals from the most recent scan, e.g. ["RUNS_PER_HOUR", "SPEED_OUTLIER"].
  signals String[] @default([])
  /// Set only by a human, via the admin endpoint.
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

## Deferred hardening — signed run tokens

Not in v1, and worth writing down so the decision is deliberate rather than forgotten.

`POST /v1/runs/start` would return a short-lived signed token binding `(userId, levelNumber,
mode, serverStartedAt)`, which `POST /v1/runs` then requires. It would make a fabricated
`elapsedMs` server-measurable rather than client-asserted.

Excluded from v1 because it puts a network round-trip **before** starting a level, in a game
whose defining property is that it plays offline. It becomes worthwhile if and when
leaderboard fraud is observed at a rate that matters. If it ships, it must degrade: an
offline start issues a local token, and the server accepts it with a `UNVERIFIED_START`
flag rather than refusing the run.

## Observability

Beyond the existing request-id → access-log → auth-audit chain:

**Metrics** (`GET /v1/admin/metrics`, and structured logs for scraping):

- Runs submitted per minute; rejection rate by reason.
- Prediction-mismatch rate, by app version. **The single most important number here** — it
  is the smoke alarm for rule drift.
- Sync batch size distribution and `receivedAt − finishedAt` percentiles. Rising p99 means
  the app is failing to sync, not that players went offline.
- Queue depths and dead-letter counts.
- Wallet drift count from the nightly reconcile. **This should be zero.**

**Alerts:**

| Condition                                        | Meaning                                 |
| ------------------------------------------------ | --------------------------------------- |
| Prediction-mismatch rate > 1% on any app version | The client and server rules disagree.   |
| Wallet drift > 0                                 | A ledger and a balance are inconsistent.|
| `RUN_IMPLAUSIBLE` rate > 5%                      | A validation rule is wrong, or an attack.|
| Dead-letter depth > 0                            | A job is failing.                       |
| A repeatable job overdue by 2× its interval      | The scheduler is wedged.                |

The first two are about **the system being wrong**, not players being wrong, and they should
be the loudest. A validation rule that rejects honest runs is a far more expensive bug than
a cheater on a weekly board.

## Tasks

1. `PlayerIntegrity`, `IntegrityState` schema; migrate.
2. `RunValidator` — hard rejections and flags, exhaustively unit-tested at boundaries.
3. `maintenance.anomaly-scan` worker writing `WATCHED` + signals.
4. Admin review endpoints: list flagged, set state with a reason, reverse a run's rewards.
5. Leaderboard eligibility reads `PlayerIntegrity.state`.
6. Metrics endpoint + structured metric logs + the alert rules above.
7. `X-Client-Predicted-Score` capture and aggregate mismatch reporting.

## Definition of done

- No client-sent value becomes a stored reward.
- A flagged player keeps playing and keeps their progress; only their leaderboard visibility changes, and only by a human decision.
- Rule drift between client and server is detected within one release, by a metric, not a bug report.
- Every enforcement action has an audit row naming a human.
