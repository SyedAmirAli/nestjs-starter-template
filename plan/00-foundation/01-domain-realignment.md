# 00.1 · Domain realignment

**Goal:** make this repository describe the product it is actually for, before a single
game table is added to it.

## Why this is phase zero

The infrastructure here was ported from a different product and never retargeted. As it
stands, the repo tells a reader it is an "AI Career OS":

| Where                             | What it still says                                                                                      |
| --------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `README.md` line 3                | "NestJS API for the glowquest AI Career OS mobile app."                                                 |
| `README.md` lines 6–11, 150–161   | Points at a `claude-plans/` directory that does not exist; documents résumé/export storage prefixes.     |
| `prisma/schema.prisma`            | `FileKind` = `RESUME_UPLOAD, JD_UPLOAD, RESUME_PDF, LETTER_PDF…`; `ModelCallFeature` = `RESUME_PARSE, TAILORING, COVER_LETTER…` |
| `prisma/schema.prisma` `UserMeta` | `pageSize` — "Default PDF page size for rendered résumés."                                              |
| `src/shared/queue/queue-names.ts` | 16 queues, every one of them résumé/LLM work: `resume.parse`, `match.analyze`, `letter.generate`…       |
| `src/app.module.ts` docblock      | "Feature modules (profile, resumes, applications, assistant) are appended below."                       |
| `.env.example`                    | `AI_API_KEY`, `AI_MODEL_PRIMARY`, `AI_MONTHLY_COST_CAP_USD`, `BACKUP_ENCRYPTION_KEY`.                   |

None of it is load-bearing for the game, and all of it will mislead every future reader —
human or agent — about what belongs where. Leaving it costs nothing today and costs
something on every single subsequent task.

The plumbing underneath is genuinely good and is **kept unchanged**: Better Auth wiring,
the Prisma service, the error/success envelope, request-id → access-log → auth-audit
middleware, the upload interceptor, `cursor.util.ts`, `RedisService`, `BaseWorker`, the
storage service, and the GitHub Actions → GHCR → SSH deploy pipeline.

## Tasks

### 1. Rewrite `README.md`

Replace the product description, the storage-layout section and the `claude-plans/`
references. Keep the Stack table (minus the LLM row), Getting started, Scripts,
Architecture, Request lifecycle, Response envelope, Auth, Logging, Environment, Testing and
Deployment sections — they are all still accurate.

Point the "feature modules are specified in…" line at `plan/` instead of `claude-plans/`.

New storage layout — every prefix that survives is one the game actually uses:

```
users/{userId}/avatars/{fileId}.{ext}     deferred to v2, see 99-appendix/04
content/levels/{packVersion}/audio/…      pronunciation audio, deferred to v2
```

Until those land, **no game feature writes to S3.** Say so, rather than leaving a layout
that implies otherwise.

### 2. Strip the wrong domain from `prisma/schema.prisma`

| Model / enum       | Action                                                                                                                              |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| `ModelCall`, `ModelCallFeature`, `ModelCallOperation` | **Delete.** No AI in v1. `TelemetryService` and `TelemetryModule` go with it. Re-add from git history if AI-generated content is ever built. |
| `File`, `FileAccessLog`, `FileKind`, `FileStatus` | **Keep the models, replace the enum members.** `FileKind` becomes `AVATAR`, `DATA_EXPORT`. The upload machinery is worth keeping intact for the deferred avatar feature; the résumé kinds are not. |
| `UserMeta.pageSize`| **Delete.** PDF page size is meaningless here. `theme`, `locale`, `timezone`, `marketingEmails`, `notificationEmails`, `onboardingCompletedAt` all stay — the game uses every one of them. |
| `User`, `Session`, `Account`, `Verification` | **Unchanged**, except `User` gains `isAnonymous` in [01-identity](../01-identity/01-anonymous-accounts.md). Better Auth owns their shape. |
| `AuditLog`, `AuditAction` | **Unchanged.** Used as-is for economy mutations and account deletion. |

`Account.scope`'s docblock references an incremental Gmail scope. Rewrite the comment;
the column stays (Better Auth owns it).

### 3. Replace the queue topology

`src/shared/queue/queue-names.ts` — delete all 16 enum members and the docblock's reasoning
about LLM vs PDF latency, which no longer applies. The game's queues are established in
[07-platform/01-jobs.md](../07-platform/01-jobs.md):

```ts
export enum QueueName {
    // Retention — cron-driven, per-timezone.
    StreakRollover = 'retention.streak-rollover',
    QuestRollover = 'retention.quest-rollover',

    // Leaderboards
    LeaderboardSnapshot = 'leaderboard.snapshot',
    LeaderboardRebuild = 'leaderboard.rebuild',

    // Identity
    GuestMerge = 'identity.guest-merge',
    AccountDelete = 'account.delete',

    // Housekeeping
    PurgeExpiredFiles = 'maintenance.purge-files',
    AnomalyScan = 'maintenance.anomaly-scan',
}
```

`deadLetterName()` and `ALL_QUEUE_NAMES` are unchanged.

### 4. Prune `.env.example` and `src/config/`

Remove `AI_API_KEY`, `AI_BASE_URL`, `AI_MODEL_PRIMARY`, `AI_MODEL_FAST`,
`AI_MONTHLY_COST_CAP_USD`, `BACKUP_ENCRYPTION_KEY`, `UPLOAD_DOCUMENT_MAX_BYTES`, and the
matching reads and boot validations in `src/config/dotenv.ts` / `src/config/validate.ts`.
Drop the `openai` dependency from `package.json`.

Add, with the same documented-key discipline the file already uses:

```bash
# --- Game -------------------------------------------------------------------
# Bumped whenever the shipped level pack changes. Clients compare it against their
# seeded pack to decide whether a full re-sync is needed rather than a delta.
LEVEL_PACK_VERSION=1

# Runs arriving faster than a human can produce them are rejected before scoring.
# Seconds per tile below which a solve is implausible — see 07-platform/02.
RUN_MIN_SECONDS_PER_TILE=0.35

# Weekly leaderboards reset at this UTC weekday/hour. Not per-timezone: one global
# reset instant is the only way two players in different countries can compare a week.
LEADERBOARD_WEEK_RESET_DOW=1
LEADERBOARD_WEEK_RESET_HOUR=0
```

`PORT` is `4000` in `.env.example` but the README's Getting started says `4100`. Fix the
README; `4000` is what `docker-compose.yml` and the deploy pipeline use.

### 5. Update `src/app.module.ts`

Remove `TelemetryModule`. Correct the closing docblock line to name the real feature
modules, in dependency order:

```
PlayerModule, LevelModule, RunModule, ProgressModule,
EconomyModule, ShopModule, RetentionModule, LeaderboardModule
```

Leave the import-order comment above it exactly as it is — that reasoning is still correct
and still load-bearing.

## Module layout to establish

Feature modules land under `src/modules/game/`, siblings of the existing
`src/modules/admin/audit/`:

```
src/modules/game/
  rewards/          pure functions ported from mobile-app/src/game/rewards.ts — NO Nest, NO DI
  player/           profile, country, languages, age band
  level/            level pack, chapters, manifest, delta sync
  run/              run submission, validation, saved-run snapshots
  progress/         per-level progress reads, batch sync
  economy/          wallet, XP, points, Powers ledger
  shop/             catalog, purchase
  retention/        daily activity, streaks, freezes, quests
  leaderboard/      global + country boards, ranking
```

`rewards/` being framework-free is deliberate: it is the one piece of code that must stay
byte-for-byte behaviourally identical to the client's, and the parity test in
[07-platform/03](../07-platform/03-testing-rollout.md) can only assert that if it imports
plain functions.

## Definition of done

- `grep -ri "resume\|career os\|cover letter\|tailoring\|jd_upload" src/ prisma/ README.md .env.example` returns nothing.
- `yarn build && yarn lint && yarn test` pass.
- `yarn db:migrate` produces one migration that drops `model_calls` and rewrites the two enums.
- The README, opened cold, describes a word game.
