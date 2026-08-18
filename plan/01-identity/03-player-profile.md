# 01.3 · Player profile

**Goal:** back the onboarding screens and the Profile tab with a real record.

## What the app already collects

| Screen                            | Field                                                     |
| --------------------------------- | ---------------------------------------------------------- |
| `setup-profile.tsx`               | Display name (max 16 chars), avatar (deferred to v2)       |
| `languages.tsx`                   | Learning language — English only in v1; the screen lists Spanish/Japanese/Arabic as future |
| `country.tsx`                     | Country (ISO-3166-1 alpha-2)                                |
| `age.tsx`                         | Age band + interests (multi-select from a fixed list)      |
| `(tabs)/profile.tsx`              | Renders name, country, player level, native/learning language, age band |

Native language is Bengali by definition of the product; it is stored rather than assumed
so the "learn X from Y" pairing is expressible later without a migration.

## Schema

```prisma
model PlayerProfile {
  id String @id @default(uuid(7)) @db.Uuid

  /// 1–16 chars after trim, matching setup-profile.tsx's MAX. Not unique — two players
  /// may share a display name; the id is the identity.
  displayName String?

  /// ISO-3166-1 alpha-2, uppercase. Drives the country leaderboard, so it is validated
  /// against a fixed list rather than accepted as free text.
  countryCode String? @db.Char(2)

  /// BCP-47. Bengali is the product's premise; English is the only learning language in v1.
  nativeLanguage   String @default("bn")
  learningLanguage String @default("en")

  ageBand   AgeBand?
  /// Free-form tags from a server-published list. Content targeting is a v2 feature; this
  /// is collected now so there is history to target on when it ships.
  interests String[] @default([])

  mergeState MergeState @default(NONE)

  onboardingCompletedAt DateTime?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  userId String @unique
  user   User   @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([countryCode])
  @@map("player_profiles")
}

enum AgeBand { UNDER_13  AGE_13_17  AGE_18_24  AGE_25_PLUS }
enum MergeState { NONE  PENDING  RUNNING  DONE  FAILED }
```

### Why a separate table from `UserMeta`

`UserMeta`'s own docblock draws the line and it is the right one: it holds **preferences**
(theme, locale, timezone, email opt-ins), not profile content. Country and age band are
game data that leaderboards and content targeting read; theme is not. Putting them in one
table would give the same row two owners and two update paths.

### Seeding

Extend the existing `user.create.after` hook in `src/auth/auth.ts` — the one that already
upserts `UserMeta` — to also upsert `PlayerProfile` and `Wallet`. Same reasoning as the
existing comment: the account should have every row it needs from the moment it exists, and
`upsert` rather than `create` so a hook re-run cannot clobber real data.

An anonymous account gets a profile with everything null. That is a valid state: the guest
flow skips onboarding entirely.

## `UNDER_13` and consent

Selecting `UNDER_13` has consequences, not just a label. The server must:

- Exclude the player from **global** leaderboards (country only, first names only).
- Force `marketingEmails = false` and refuse to set it true.
- Suppress referral features when they ship.

Encode this as a single `PlayerPolicy.forAgeBand(band)` helper read by every feature, rather
than an `if (UNDER_13)` scattered across modules. It is the kind of rule that gets added to
four call sites and missed at the fifth.

## Endpoints

### `GET /v1/players/me`

```jsonc
// 200
{
  "id": "0192f3…",
  "displayName": "Rafi",
  "countryCode": "BD",
  "nativeLanguage": "bn",
  "learningLanguage": "en",
  "ageBand": "AGE_18_24",
  "interests": ["Travel", "Tech"],
  "isAnonymous": false,
  "onboardingCompletedAt": "2026-08-14T11:02:41.000Z",
  "level": 12,                    // from the economy module — see 04-economy/01
  "xp": { "total": 6480, "intoLevel": 620, "forLevel": 1000 },
  "leaderboardEligible": true     // false for anonymous or UNDER_13; the app explains why
}
```

One denormalized read for the whole Profile tab. `(tabs)/profile.tsx` currently pulls from
`mock.player` plus `useWallet()`; this replaces both.

### `PATCH /v1/players/me`

Partial, `UserRegistryService.toWritable`-style: absent leaves unchanged, explicit `null`
clears, `''` normalises to `null`.

```jsonc
// request — every field optional
{ "displayName": "Rafi", "countryCode": "BD", "ageBand": "AGE_18_24",
  "interests": ["Travel", "Tech"], "learningLanguage": "en" }
```

Validation:

| Field              | Rule                                                                     | Error code                |
| ------------------ | ------------------------------------------------------------------------ | ------------------------- |
| `displayName`      | trim, 1–16 chars, no control chars, profanity-screened                    | `DISPLAY_NAME_INVALID`    |
| `countryCode`      | must be in the published country list                                     | `COUNTRY_UNSUPPORTED`     |
| `learningLanguage` | must be in the published language list (`["en"]` in v1)                   | `LANGUAGE_UNSUPPORTED`    |
| `interests`        | subset of the published interest list, max 6                              | `INTEREST_UNSUPPORTED`    |
| `ageBand`          | enum                                                                      | `VALIDATION_FAILED`       |

`displayName` appears on leaderboards, which makes it user-generated content visible to
strangers. Screen it on write — a denylist plus a length/charset check is enough for v1, and
it is far cheaper than moderating after the fact.

**Country changes are rate-limited to once per 30 days** (`COUNTRY_CHANGE_TOO_SOON`, 429).
Without that, a player hops to whichever country's leaderboard they can top this week.

### `POST /v1/players/me/onboarding-complete`

Sets `onboardingCompletedAt` and mirrors it onto `UserMeta.onboardingCompletedAt`. Idempotent —
the first timestamp wins.

### `GET /v1/reference` — public

The lists the client validates against, served rather than hard-coded so a new country never
requires an app release. Cached 24h, ETag'd.

```jsonc
{
  "countries":  [{ "code": "BD", "name": "Bangladesh", "playerCount": 1204331 }, …],
  "languages":  [{ "code": "en", "name": "English", "levelCount": 50, "available": true },
                 { "code": "es", "name": "Spanish", "levelCount": 0, "available": false }, …],
  "ageBands":   [{ "value": "UNDER_13", "label": "Under 13", "hint": "Simple words" }, …],
  "interests":  ["Travel", "Food", "Tech", "Sports", "Music", "Business"]
}
```

This directly replaces `mock.countries`, `mock.learnLanguages`, `mock.ageGroups` and
`mock.interests`. `playerCount` makes the country list's "1.2M players" real; `available:
false` is what lets `languages.tsx` keep showing Spanish as a coming-soon card without
lying about it.

## Tasks

1. `PlayerProfile` + `AgeBand` + `MergeState` schema; migrate.
2. Seed the row in `user.create.after` alongside `UserMeta`.
3. `PlayerModule` — controller, service, DTOs, `PlayerPolicy`.
4. `ReferenceController` — public, cached, ETag'd; back the country list with a real count query.
5. Display-name screening + the 30-day country cooldown in Redis.
6. e2e: onboard → read back → partial update → country cooldown rejects the second change.

## Definition of done

- `(tabs)/profile.tsx` renders with zero imports from `src/data/mock.ts`.
- An `UNDER_13` account cannot be made leaderboard-visible or marketing-opted-in by any request.
- Adding a country requires no app release.
