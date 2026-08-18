# 07.1 · Scheduled jobs

**Goal:** everything that has to happen on a clock rather than on a request, in one place.

## The topology

Replacing `src/shared/queue/queue-names.ts` wholesale (see
[00-foundation/01](../00-foundation/01-domain-realignment.md)):

| Queue                          | Trigger              | Concurrency | Purpose                                          |
| ------------------------------ | -------------------- | ----------- | ------------------------------------------------ |
| `retention.streak-rollover`    | hourly, :30          | 1           | Cross local midnight per timezone; consume freezes|
| `retention.quest-rollover`     | hourly, :30          | 1           | Roll tomorrow's quests; forfeit stale ones        |
| `leaderboard.snapshot`         | hourly, :05          | 1           | Redis → `leaderboard_entries`                     |
| `leaderboard.rebuild`          | nightly 03:00 UTC + on demand | 1  | Rebuild sorted sets from Postgres                 |
| `identity.guest-merge`         | on `onLinkAccount`   | 4           | Merge a guest into a real account                 |
| `account.delete`               | on request + nightly | 2           | Self-service deletion; orphan anonymous sweep     |
| `maintenance.purge-files`      | nightly 04:00 UTC    | 1           | Expired file rows + objects (v2, avatars)         |
| `maintenance.anomaly-scan`     | nightly 04:30 UTC    | 1           | Flag suspicious accounts; wallet drift report     |

Every one runs on `BaseWorker` with dead-lettering to `<queue>.dead`, which the repo already
provides.

## Repeatable jobs, not cron in code

Use BullMQ repeatable jobs registered at boot, with a **stable `jobId` per schedule**. A
repeatable job registered without a stable id accumulates a duplicate schedule on every
deploy, and the symptom — the nightly rebuild running four times — appears weeks later and
looks like a data bug.

```ts
await queue.add(
    'streak-rollover',
    {},
    { repeat: { pattern: '30 * * * *', tz: 'UTC' }, jobId: 'cron:streak-rollover' },
);
```

At boot, reconcile: list existing repeatable jobs, remove any whose pattern no longer matches
the code, then register. Do this in a dedicated `SchedulerService.onApplicationBootstrap`,
not scattered across feature modules.

`RUN_WORKERS_IN_PROCESS` must be `true` on the current single-container deploy or every job
above is enqueued and never consumed. Assert it at boot and log loudly if it is false while
`NODE_ENV=production` and no separate worker pool is configured.

## The hourly retention job in detail

This is the only genuinely subtle schedule, because "midnight" is not one moment.

```
every hour at :30 UTC
  → for each distinct UserMeta.timezone in use:
        localNow = now in tz
        if localNow.hour == 0:                    # this timezone just crossed midnight
            enqueue a per-timezone child job
  → child job(tz):
        streak rollover  (see 05-retention/01)
        quest roll       (see 05-retention/02)
```

Bucketing by timezone rather than iterating players is what keeps this O(timezones) at the
top level instead of O(players) every hour. There are fewer than 40 distinct UTC offsets in
practice, and the per-timezone child job is the only thing that touches player rows.

Each child job processes players in **batches of 500 with a cursor**, not a single
transaction. A rollover that locks every player in Bangladesh for the duration is an outage.
Batching means a failure retries 500 rows, and every operation inside is idempotent
(recompute-from-source, not increment), so retrying a partially-completed batch is safe.

## Idempotency of scheduled work

Every job in the table is written so that running it twice, or running it after a partial
failure, changes nothing:

| Job                   | What makes it safe to re-run                                                |
| --------------------- | --------------------------------------------------------------------------- |
| Streak rollover       | Freeze consumption is guarded by `DailyActivity(userId, date).freezeUsed`. Streaks recompute from `DailyActivity` rather than incrementing. |
| Quest roll            | The draw is deterministic on `hash(userId, localDate)`; instances are `@@unique([userId, localDate, definitionId])`. |
| Leaderboard snapshot  | Upsert by `@@unique([userId, scope, period])`.                              |
| Leaderboard rebuild   | Builds into a temp key and `RENAME`s. Never mutates a live key in place.     |
| Guest merge           | Every merge rule is a max/union/recompute; guarded by `mergeState`.          |
| Anomaly scan          | Writes flags, never balances.                                               |

That property is not a nicety. A worker that is killed mid-batch on deploy is a weekly
event, and "safe to re-run" is what turns that from an incident into a retry.

## Observability

Every job logs, on completion: name, duration, rows touched, and a one-line summary.
Failures dead-letter with the payload intact.

A `GET /v1/admin/jobs/status` endpoint reports, per queue: depth, active, failed, the last
successful run, and dead-letter depth. The first question during any incident is "did the
nightly job run", and it should not require a Redis CLI to answer.

Alert on: dead-letter depth > 0, any queue depth growing over three consecutive checks, and
a repeatable job that has not completed within twice its interval.

## Tasks

1. Replace `QueueName`; delete the résumé/LLM queues.
2. `SchedulerService` with boot-time repeatable-job reconciliation and stable `jobId`s.
3. Timezone-bucketing parent job + batched per-timezone child jobs.
4. Workers for each queue in the table, all on `BaseWorker`.
5. `RUN_WORKERS_IN_PROCESS` boot assertion.
6. `GET /v1/admin/jobs/status`.
7. Tests: rollover across DST, a killed-and-retried batch, a repeatable job surviving three consecutive deploys without duplicating.

## Definition of done

- Deploying three times does not create three schedules.
- Every job is safe to run twice.
- Local midnight is handled correctly in every timezone in use, including half-hour offsets.
- "Did last night's job run?" is one HTTP call.
