# 03.2 · Progress sync

**Goal:** reconcile a device that has been playing offline with the server, in both
directions, without losing or duplicating anything.

## The shape of the problem

The mobile app's SQLite is not a cache — it is a full, writable replica. A player can clear
30 levels on a plane. So this is genuine two-way sync, and it needs the usual three answers:

1. **Push** — what did the device do that the server has not seen?
2. **Pull** — what does the server know that the device does not (a second device, a merge)?
3. **Conflict** — when both changed the same `(level, mode)`, who wins?

Answer to (3), and the reason the rest is simple: **every conflict on level progress is
resolved by max/min, not by timestamp.** Best stars is the higher, best time is the lower,
best score is the higher. Two devices playing the same level cannot produce a conflict that
needs a winner — only a merge. This is the same rule as [guest merge](../01-identity/02-guest-merge.md),
and it is the property that makes offline-first safe here.

## Push — `POST /v1/progress/sync`

A batch of queued runs. Not a separate code path: each item goes through exactly the same
`RunService.submit()` as [a live submission](01-run-submission.md), with the same
idempotency and the same validation. The batch endpoint exists to save round-trips, not to
relax rules.

```jsonc
// request — max 100 runs
{
  "runs": [
    { "clientRunId": "0192…", "levelNumber": 12, "mode": "word", "elapsedMs": 32400,
      "powersUsed": { "hint": 1, "reveal": 0, "shuffle": 0 },
      "startedAt": "…", "finishedAt": "…" }
  ],
  "clientState": {
    "packRevision": 37,
    "lastSyncedAt": "2026-08-18T22:40:00.000Z"
  }
}
```

```jsonc
// 200
{
  "message": "Progress synced",
  "localeKey": "updated.progress.sync",
  "status": "normal",
  "data": {
    "accepted": 28,
    "duplicates": 2,                   // already seen by clientRunId — not an error
    "rejected": [
      { "clientRunId": "0192…", "code": "RUN_IMPLAUSIBLE",
        "message": "Solve time below the minimum for this level." }
    ],
    "state": { /* the same payload as GET /v1/progress, below */ }
  }
}
```

Rules that make this safe to retry blindly:

- **Runs are processed in `finishedAt` order**, not array order. Milestone grants and
  personal bests depend on sequence, and a client that queued out of order must still get
  the right answer.
- **Partial success is the normal outcome.** One bad run never fails the batch. The client
  drops accepted and duplicate ids from its queue and surfaces rejections; a rejected run
  is dropped too, not retried forever.
- **The whole batch is idempotent**, because each item is. Re-sending a batch verbatim
  yields `accepted: 0, duplicates: 30` and identical state.
- Cap at 100 runs; beyond that, `413 BATCH_TOO_LARGE` with instructions to page. A device
  returning from a month offline sends several batches.

## Pull — `GET /v1/progress`

Everything the device needs to reconcile itself, in one read.

```jsonc
// 200
{
  "syncedAt": "2026-08-19T09:20:00.000Z",
  "wallet": { "totalScore": 1284, "points": 1254, "powers": 9,
              "xpTotal": 6525, "level": 12, "xpIntoLevel": 665, "xpForLevel": 1000 },
  "tracks": {
    "word":     { "levelsCompleted": 15, "highestCleared": 15, "totalStars": 39,
                  "milestone": { "levelsIntoMilestone": 1, "levelsRemaining": 6,
                                 "targetLevelCount": 21, "pct": 14.28 } },
    "sentence": { "levelsCompleted": 9,  "highestCleared": 9,  "totalStars": 22,
                  "milestone": { … } }
  },
  "levels": [
    { "levelNumber": 1, "mode": "word", "stars": 3, "bestTimeMs": 11200,
      "bestScore": 20, "attempts": 4, "firstClearedAt": "…", "lastPlayedAt": "…" }
  ],
  "streak": { "current": 15, "longest": 21, "freezesLeft": 2,
              "lastActiveDate": "2026-08-19", "extendedToday": true }
}
```

`?since=<ISO>` filters `levels` to rows changed after that instant, for a device that only
needs a top-up. `wallet`, `tracks` and `streak` are always sent in full — they are small,
and a partially-updated wallet is a bug worth designing out.

`levels` is capped at 500 rows with cursor pagination past that. At 2,400 levels × 2 modes
the full set is genuinely large, and the client already stores it locally; a full pull is a
recovery operation, not a routine one.

## Merging on the device

The server's answer is authoritative for everything derived (wallet, XP, points, Powers,
streak) and is written over local state outright. For `levels`, the device applies the same
max/min merge rather than overwriting:

```
stars      = max(local, server)
bestTimeMs = min(local, server)   -- null loses
bestScore  = max(local, server)
attempts   = max(local, server)   -- server counts only what it received
```

This matters because a run may be sitting in the local queue, not yet pushed. Overwriting
would erase it from the map until the next sync completes, which the player would see as
progress flickering backwards.

## Saved runs — cross-device resume

`mobile-app/src/db/runs.ts` stores an interrupted board per `(level, mode)`: `slots`,
`tileOrder`, `powers`, `elapsedSeconds`. Syncing it lets a player put a phone down and pick
the same board up on a tablet.

| Method   | Path                                    | Purpose                                 |
| -------- | --------------------------------------- | --------------------------------------- |
| `GET`    | `/v1/runs/saved`                        | All saved boards for the player          |
| `PUT`    | `/v1/runs/saved/:levelNumber/:mode`     | Upsert one                               |
| `DELETE` | `/v1/runs/saved/:levelNumber/:mode`     | Clear one (on finish or restart)         |

```prisma
model SavedRun {
  id     String @id @default(uuid(7)) @db.Uuid
  userId String

  levelNumber Int
  mode        GameMode

  /// Indices into the deterministically-derived tile pool, exactly as the client stores
  /// them. The pool comes from letterPool()/wordPool() over the level's answer, so the
  /// indices stay meaningful across devices — as long as the level's answer is unchanged.
  slots     Int[]
  tileOrder Int[]
  powers    Json
  elapsedMs Int

  /// The pack revision the board was created against. If the level's text changed since,
  /// the indices no longer mean anything and the board is discarded rather than restored.
  packRevision Int

  updatedAt DateTime @updatedAt

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([userId, levelNumber, mode])
  @@map("saved_runs")
}
```

`packRevision` is the one non-obvious field and it is essential. The client's own comment
in `runs.ts` explains that slots are indices into a pool derived from the level's answer —
so if the answer changes, restoring is not merely wrong, it is unrecoverably wrong. On
mismatch the server returns `410 SAVED_RUN_STALE` and the client starts fresh.

Conflict on a saved run is resolved by **latest `updatedAt` wins**. Unlike progress, there is
no merge that makes sense for two half-finished boards.

Do not sync boards that fail the client's own `isResumable()` test (`slots.length > 0 ||
elapsedSeconds >= 10`) — opening a level and backing out should not create server traffic.

## Sync cadence on the client

```
app foreground     → GET /v1/levels/manifest, then GET /v1/progress?since=lastSync
run finishes       → POST /v1/runs; on failure, queue locally and continue
queue non-empty    → POST /v1/progress/sync on the next successful connection
app background     → flush saved runs
```

`POST /v1/runs` failing is a completely normal event, not an error state. The success screen
renders from the local prediction and the queue drains later. Nothing in the UI may block on
it.

## Tasks

1. `ProgressModule` — `GET /v1/progress`, `POST /v1/progress/sync`.
2. `SavedRun` schema + endpoints with the `packRevision` staleness gate.
3. Ordered, partial-success batch processing over `RunService.submit()`.
4. Mobile: an outbox table for queued runs, plus the max/min merge on pull.
5. e2e: 30 offline runs → sync → correct milestones and streak; re-send the same batch → no change.
6. e2e: save a board, edit the level, publish → the board is refused as stale rather than restored wrong.

## Definition of done

- A device offline for a week syncs to exactly the state it would have reached online.
- Re-sending any batch is a no-op.
- No sync path can lower a player's stars, best time or balances.
- Nothing in the play loop awaits a network call.
