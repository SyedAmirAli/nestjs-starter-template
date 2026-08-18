# A4 · Deferred to v2

What v1 deliberately leaves out, why, and what v1 does so that adding it later is not a
migration of everything.

Each item below is **designed far enough** that the v1 schema does not have to be reopened
to accommodate it. That is the entire purpose of this document: a deferral that leaves no
seam is just a surprise.

## Achievements

`achievements.tsx` renders six: "Gold sprinter", "Perfect run", "Word master", "Top 100 in
BD", "Diamond mind", "Sentence smith".

**Why deferred:** achievements are a rules engine over the same event stream as quests, and
building two rules engines in one release is how both end up half-right. The quest engine
ships first and proves the shape.

**How v1 stays compatible:** every fact an achievement needs is already recorded —
`Run` (stars, powers used, elapsed), `LevelProgress` (per-level bests), `DailyActivity`
(days played), `LeaderboardEntry` (historical rank). Achievements are a *backfillable*
feature: when they ship, an evaluation job walks existing history and awards retroactively.
Nothing has to be recorded in advance.

```prisma
// v2
model AchievementDefinition { id, code, title, description, iconKey, rule Json, isActive }
model AchievementUnlock     { id, userId, definitionId, unlockedAt, progress, @@unique([userId, definitionId]) }
```

`rule Json` rather than a typed column set, because the six above have six different shapes
and a column per predicate would be a schema change per achievement.

Until then, `achievements.tsx` stays on `mock.achievements`.

## Milestones as records

`milestones.tsx` shows "First perfect run", "7-day streak", "100 words built", "Reach
chapter 2", "Player level 25", "Clear chapter 1 perfectly" — with `done`/`progress`/`locked`
states and progress bars.

**Why deferred:** it is the same engine as achievements, differing only in presentation.
Ship one engine, render it twice.

**Note the naming collision.** "Milestone" already means something specific in v1: the
Powers grant every 7 cleared levels, from `mobile-app/src/game/rewards.ts`. That one **is**
in v1 and is computed, not stored. When this screen is built, name its entity something else
— `Goal` or `Achievement` — or the two will be confused in every future conversation.

## Referrals

`referral.tsx` is fully built: a code, a copy button, a share sheet, stats, and an invite
list. `mock.freePoints` promises "Invite a friend · 500 points".

**Why deferred:** referrals are a payout mechanism, which makes them a fraud target on day
one. Self-referral, device farms, and rewards claimed for accounts that never play are all
real, and defending against them needs the anomaly infrastructure from
[07-platform/02](../07-platform/02-anti-cheat.md) to already exist and be trusted.

**How v1 stays compatible:** `LedgerSource.REFERRAL_REWARD` is **already in the v1 enum**.
Adding referrals adds tables, not an enum migration on a hot table.

```prisma
// v2
model ReferralCode   { id, userId @unique, code @unique, createdAt }
model ReferralClaim  { id, referrerId, refereeId @unique, claimedAt,
                       qualifiedAt,          // referee reached level 5 — the payout trigger
                       rewardPaidAt, ipHash, deviceHash }
```

Payout rules when it ships: referee gets 200 points immediately; referrer gets 500 **only
when the referee reaches player level 5**, which is what `referral.tsx` already says. Both
are points, never score or XP — the screen's own comment gets this right: "rewards are
Points, never XP, so inviting friends can't move you up the leaderboard."

Anti-abuse: one claim per referee ever, referrer ≠ referee, an anonymous account cannot
refer, and hashed IP/device correlation feeds the anomaly scan.

## Avatar upload

`setup-profile.tsx` has the camera button; `profile.tsx` falls back to the Lumo bust.

**Why deferred:** user-uploaded images visible to strangers on a leaderboard means
moderation, and moderation is a product commitment, not a feature.

**How v1 stays compatible:** the entire upload path is already built and being kept —
`src/shared/storage/`, `src/common/upload/`, presigned direct PUT with server-side MIME
sniffing at `complete`, `File` + `FileAccessLog` with the `PENDING → READY → PURGED`
lifecycle. `FileKind.AVATAR` is in the v1 enum. This is a controller and a moderation
decision, not an infrastructure project.

Interim: a fixed set of server-published avatar art keys the player picks from. All the
personalisation, none of the moderation.

## Additional learning languages

`languages.tsx` shows Spanish, Japanese and Arabic beside English.

**Why deferred:** no content exists. This is a content problem, not an engineering one.

**How v1 stays compatible:** `LevelPack` is already keyed
`@@unique([nativeLanguage, learningLanguage])`, and `PlayerProfile.learningLanguage` already
exists. `GET /v1/reference` already returns languages with `available: false`, which is what
lets that screen keep showing coming-soon cards honestly. Adding Spanish is a seeded pack and
a flag flip.

The one thing that needs thought when it lands: progress is currently keyed on
`(userId, levelNumber, mode)`, which assumes one pack. A second pack needs `packId` in that
key. **That is a real migration** — worth knowing now, and worth not paying for until there
is a second pack.

## Pronunciation audio

Every level carries `wordPronunciation` (IPA) and `bnPronunciation` (Bengali
transliteration), and `src/audio/use-pronunciation.ts` exists in the app.

**Why deferred:** audio for 2,400 levels × 2 modes is a recording and CDN project.

**How v1 stays compatible:** the storage prefix `content/levels/{packVersion}/audio/…` is
reserved in [00-foundation/01](../00-foundation/01-domain-realignment.md). `Level` gains
nullable `wordAudioKey` / `sentenceAudioKey` columns, which is an additive migration and a
delta-sync field the client can ignore until it exists.

## In-app purchase

**Why deferred:** store review, receipt validation, refunds, tax, and a fraud surface.
`shop.tsx`'s "Points" tab is empty in v1 for exactly this reason.

**How v1 stays compatible:** `PriceKind.IAP` is **already in the v1 enum** and
`ShopItem.grants` is JSON. A points pack is a row plus a receipt-validation service, not a
schema change.

## Push notifications

The daily reminder is device-local today (`mobile-app/src/reminder/`) and stays that way in
v1 — the OS holds the schedule and it works with no server, which is strictly better for a
reminder.

**Deferred:** server-sent pushes (streak-about-to-break, a friend passed you, a new pack).
Those genuinely need a server, and they need `UserMeta.timezone` — which v1 already makes
load-bearing and correct.

## Social

Friends, following, private leagues, challenges. Nothing in the app hints at them and
nothing in v1 blocks them. Listed only so the absence is a decision.

## What is NOT deferred, despite looking optional

Worth stating, because each is easy to cut and expensive to add later:

| Feature                  | Why it must be in v1                                                            |
| ------------------------ | -------------------------------------------------------------------------------- |
| The ledger               | Retrofitting a ledger onto existing balances means the history before it is unexplainable, forever. |
| Idempotency keys         | Adding them later means every client already in the field lacks them.            |
| `PlayerIntegrity`        | The first cheater arrives before the tooling does, otherwise.                     |
| Anonymous accounts       | Adding them later means every existing guest has no server identity to migrate.   |
| `packRevision` on saved runs | Without it, the first content edit silently corrupts in-progress boards.      |
| Server-side timezone     | Streaks computed in UTC are wrong for the entire target market, and the fix is a backfill nobody can verify. |
