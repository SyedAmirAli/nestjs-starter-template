# 02.1 · Level pack — server-owned content with delta sync

**Goal:** the 50-level pack currently bundled in the app becomes server content that can
grow to the 2,400 levels the UI already advertises, without an app release.

## The situation today

`mobile-app/src/data/levels.json` holds 50 levels. `src/db/levels.ts` seeds them into
SQLite on first launch, gated by a `SEED_VERSION` constant that must be bumped by hand when
the JSON changes. Its own docblock in `src/db/client.ts` says the plan is to "upsert from
server payloads instead of the bundled JSON without touching callers", and
`src/lib/api.ts` already sketches `levels.getAll` as `GET ?fromDate= -> Level[]` with the
note that the offline seed "becomes the first-launch fallback and this becomes the source of
truth, diffed in by id/updatedAt rather than replacing the whole pack".

This plan is that, made concrete. Two corrections to the sketch:

- **Diff by revision, not by date.** `?fromDate=` breaks on clock skew and on a level edited
  twice in the same second. A monotonic integer `revision` per pack is unambiguous.
- **Deletions must be transmitted.** A date-filtered list of changed rows can never tell a
  client that level 34 was withdrawn. Tombstones are part of the delta.

## Schema

```prisma
model LevelPack {
  id String @id @default(uuid(7)) @db.Uuid

  /// The learning pair this pack teaches, e.g. bn→en. One pack per pair.
  nativeLanguage   String
  learningLanguage String

  /// Monotonic. Incremented once per publish, by the publish transaction, never by hand.
  /// This is the whole sync contract: a client at revision N asks for everything since N.
  revision Int @default(0)

  /// Bumped only for changes a delta cannot express (re-numbered levels, changed chapter
  /// boundaries). A client on an older packVersion must full-resync, not delta.
  packVersion Int @default(1)

  publishedAt DateTime?
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt

  levels   Level[]
  chapters Chapter[]

  @@unique([nativeLanguage, learningLanguage])
  @@map("level_packs")
}

model Chapter {
  id     String @id @default(uuid(7)) @db.Uuid
  packId String @db.Uuid

  /// 1-based. buildMap() in the client keys its backdrop art off this.
  number  Int
  title   String            // "FOREST", "FROST PEAKS"
  /// Asset key in the client's typed registry (mobile-app/src/assets.ts), not a URL.
  /// Art ships with the binary; sending a key keeps content sync text-only.
  artKey  String?

  levels Level[]
  pack   LevelPack @relation(fields: [packId], references: [id], onDelete: Cascade)

  @@unique([packId, number])
  @@map("chapters")
}

model Level {
  id     String @id @default(uuid(7)) @db.Uuid
  packId String @db.Uuid
  chapterId String @db.Uuid

  /// The number the player sees and the client keys everything on — the `level_id` in the
  /// device's `progress`, `saved_runs` and every run submission. Stable for the life of the
  /// pack: renumbering is a packVersion bump, not a revision bump.
  number Int

  wordEn             String
  wordBn             String
  wordPronunciation  String   // IPA, e.g. /ˈflaʊ.ər/
  wordBnPronunciation String  // Bengali transliteration, e.g. ফ্লাওয়ার
  wordXp             Int

  sentenceEn            String
  sentenceBn            String
  sentencePronunciation String
  sentenceXp            Int

  /// Withdrawn rather than deleted, so the delta can carry a tombstone to clients that
  /// still hold the row. Swept only after every supported app version has cycled past it.
  retiredAt DateTime?

  /// Bumped on every edit. Not a timestamp: a client asks "what changed since revision N",
  /// and that question has to have one unambiguous answer.
  revision Int @default(0)

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  pack    LevelPack @relation(fields: [packId], references: [id], onDelete: Cascade)
  chapter Chapter   @relation(fields: [chapterId], references: [id], onDelete: Restrict)

  @@unique([packId, number])
  @@index([packId, revision])
  @@map("levels")
}
```

`wordXp` and `sentenceXp` are **stored columns, not derived**. The client currently computes
them at seed time (`wordXp = 20 + (chapter - 1) * 10`, `sentenceXp = wordXp + 20`). Storing
them lets a single level be re-tuned without changing a global formula and without an app
release, which is the entire reason content is moving server-side. The seed script
reproduces today's values exactly so nothing changes on day one.

## Endpoints — all public

Level content is not user data. It is public, cacheable, and must be readable before
sign-in — the app has to be playable while an anonymous sign-in is still in flight.

### `GET /v1/levels/manifest`

The cheap "do I need to do anything" call, made on every app foreground.

```jsonc
// 200 — ETag: "pack:1:rev:37"
{
  "packVersion": 1,
  "revision": 37,
  "levelCount": 50,
  "chapterCount": 5,
  "publishedAt": "2026-08-18T12:00:00.000Z",
  "nativeLanguage": "bn",
  "learningLanguage": "en"
}
```

A client holding `revision: 37` sends `If-None-Match` and gets `304` with no body. That is
the overwhelmingly common case and it should cost almost nothing.

### `GET /v1/levels?since=<revision>&limit=200&cursor=<c>`

The delta.

```jsonc
// 200
{
  "packVersion": 1,
  "revision": 37,                  // the revision this response brings the client to
  "fullResyncRequired": false,     // true if `since` predates the current packVersion
  "chapters": [
    { "number": 1, "title": "MEADOW", "artKey": "chapter.chapter-meadow" }, …
  ],
  "levels": [
    { "number": 12, "chapter": 2, "revision": 37,
      "word": { "en": "HOUSE", "bn": "বাড়ি", "pronunciation": "/haʊs/",
                "bnPronunciation": "হাউস", "xp": 30 },
      "sentence": { "en": "This is my house", "bn": "এটা আমার বাড়ি",
                    "pronunciation": "দিস ইজ মাই হাউস", "xp": 50 } }
  ],
  "retired": [34, 41],             // tombstones — delete these level rows locally
  "nextCursor": null
}
```

Rules the client relies on:

- `since` omitted → the full pack. `since` ≥ current revision → empty arrays, same revision.
- `chapters` is always sent **in full**. There are single digits of them and partial chapter
  state is a class of bug not worth enabling.
- `levels` is paginated. `nextCursor` non-null means keep going; the client must **not**
  advance its stored revision until the last page lands, or an interrupted sync leaves it
  claiming a revision it does not have.
- `fullResyncRequired: true` means discard the local `levels` table and re-fetch with no
  `since`. Local `progress` is keyed on level *number* and is **not** discarded.

### `GET /v1/levels/:number`

One level, for a deep link or a repair. Rarely used; included because `src/lib/api.ts`
already declares it and because "one row is wrong on one device" needs an answer that is not
a full resync.

## Client-side changes

`src/db/levels.ts` gains a revision-aware upsert path beside its existing seed:

```
first launch          → seed from bundled levels.json, record revision 0, packVersion 1
every foreground      → GET /v1/levels/manifest
  manifest.revision > local          → GET /v1/levels?since=local, upsert, delete retired,
                                       then store the new revision
  manifest.packVersion > local       → wipe `levels`, full fetch, keep `progress`
  network unavailable                → carry on with what is stored; the game never blocks
```

The bundled JSON stays in the binary permanently as the first-launch fallback. A brand-new
install on a plane must still be playable, and that is only true if the content ships with
the app.

## Authoring and publishing

Content is not edited through the mobile API. For v1:

- `scripts/seed-levels.ts` imports `mobile-app/src/data/levels.json` verbatim, creating pack
  `bn→en` at `packVersion 1, revision 1` with the five chapters the map already implies.
- Admin CRUD lives under `/v1/admin/levels/*`, `ADMIN` role only, and is **draft-first**:
  edits accumulate without touching `LevelPack.revision`, and a single
  `POST /v1/admin/levels/publish` bumps the revision inside one transaction.

That last property matters more than it looks. If each edit bumped the revision, a client
syncing mid-edit would receive a half-updated chapter and cache it as complete.

## Caching

`RedisService.getOrSet` on `levels:pack:{packId}:manifest` and
`levels:pack:{packId}:delta:{since}:{cursor}`, TTL 1 hour, **explicitly invalidated by the
publish transaction** rather than waiting for expiry. A publish that takes an hour to reach
players is not a publish.

## Tasks

1. Schema for `LevelPack`, `Chapter`, `Level`; migrate.
2. `scripts/seed-levels.ts` from the existing JSON; verify the 50 rows and their XP values match today's client-side computation exactly.
3. `LevelModule` — manifest, delta, single-level reads; public; ETag + Redis.
4. Admin draft/publish controller with a transactional revision bump and cache invalidation.
5. Mobile: revision-aware upsert in `src/db/levels.ts`, replacing the `SEED_VERSION` gate.
6. e2e: seed → sync from scratch → edit + publish → delta carries exactly the changed rows → retire a level → tombstone arrives.

## Definition of done

- A fresh device with no network plays levels 1–50 from the bundled pack.
- A device at revision N receives only what changed, and a level retired server-side disappears from the map.
- A client that syncs 200 levels and is killed mid-pagination re-syncs correctly rather than claiming a revision it never finished.
- Publishing 50 new levels requires no app release.
