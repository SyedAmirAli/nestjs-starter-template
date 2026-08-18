# A3 · Mobile integration

What changes in `../mobile-app`, file by file. This is the other half of the work, and it
belongs in the plan because several backend decisions were made *because* of what the app
already does.

## The guiding rule

**The app must remain playable with the network off, at every stage.** SQLite stops being
"the database" and becomes "the offline replica plus the outbox". No screen may show a
spinner where it currently shows content.

## New files

| File                              | Purpose                                                                     |
| --------------------------------- | --------------------------------------------------------------------------- |
| `src/lib/auth-client.ts`          | Better Auth Expo client; anonymous sign-in on first launch; token in `expo-secure-store` |
| `src/db/outbox.ts`                | Queue of unsent runs and saved-run writes; drained on connectivity           |
| `src/sync/sync-manager.ts`        | Foreground/background orchestration: manifest → levels → progress → outbox   |
| `src/api/*.ts`                    | One typed module per resource (`players`, `levels`, `runs`, `progress`, `economy`, `shop`, `streak`, `quests`, `leaderboard`) |

## Changed files

### `src/config/env.ts`

`apiBaseUrl` is `https://api.glowquest.app` today with a comment saying it is a placeholder.
Replace with a build-profile value (`app.config.ts` `extra`, read via `expo-constants`) so
dev, staging and production differ without editing a committed file. Add the remote-config
flags that gate [the rollout stages](../07-platform/03-testing-rollout.md).

### `src/lib/api.ts`

The `endpoints` map is a good sketch and mostly needs correcting rather than replacing:

- Paths are `/v1/*`, **not** `/api/v1/*` — the backend mounts at `/v1`.
- `auth.login` / `auth.logout` belong to Better Auth's own router at `/api/auth/*`, not to this API.
- `levels.getAll`'s `?fromDate=` becomes `?since=<revision>`; add `levels.manifest`.
- Add the run, progress, economy, shop, streak, quest and player groups.

The axios interceptor already normalises failures into `ApiRequestError` with `statusCode`
and `code`, which matches the backend envelope exactly. **No change needed there** — it was
written against the right contract.

Add request interceptors for `Authorization`, `X-App-Version`, `X-Platform` and
`X-Client-Predicted-Score`.

### `src/session/session.ts`

Its own docblock already predicts this: "This is deliberately *not* an auth token… When the
backend lands, real credentials belong beside it (in secure storage), and `status` becomes a
projection of whether those exist."

Do exactly that. The token goes to `expo-secure-store`; `status` becomes
`isAnonymous ? 'guest' : 'member'`. `upgradeGuestToMember` stops being an alias for
`startMemberSession` and becomes the real thing: sign in, then poll
`GET /v1/players/me/merge-status`, then show the merge summary.

### `src/db/levels.ts`

Replace the `SEED_VERSION` gate with revision-aware sync:

- Bundled `levels.json` stays as the first-launch fallback — permanently. A new install on
  a plane must be playable.
- Add `pack_revision` and `pack_version` to the `meta` table.
- New `applyLevelDelta(payload)` — upsert changed levels, delete tombstoned ones, advance
  the stored revision **only after the last page lands**.
- `recordProgress()` keeps working exactly as it does, and additionally writes to the outbox.
  It stays the local prediction; the server's answer arrives and overwrites.

### `src/game/rewards.ts`

**Do not fork.** This file is the client half of the parity contract from
[07-platform/03](../07-platform/03-testing-rollout.md). Add the parity fixture as a unit
test in this repo, so a server-side constant change turns the mobile CI red.

Add `levelFromXp` / `xpForLevel`, mirroring the server, so the Progress tab can render
optimistically.

### `src/game/useBoard.ts`

`FRESH_POWERS = { hint: 3, reveal: 1, shuffle: 5 }` currently resets every board, which makes
Powers effectively unlimited. Replace with the wallet balance, spent optimistically and
reconciled at run submission (see [04-economy/01](../04-economy/01-wallet.md)).

Note the server keeps **one Powers pool**, not three. The board decides which kind of help
each Power buys.

### Screens — mock removal

Each of these imports from `src/data/mock.ts` today. The table is the checklist; when it is
empty, `src/data/mock.ts` is deleted.

| Screen                    | Currently imports                        | Replaced by                                                    |
| ------------------------- | ---------------------------------------- | -------------------------------------------------------------- |
| `(tabs)/play.tsx`         | `liveBoard`, `player`                    | `GET /v1/progress` + local levels                              |
| `(tabs)/progress.tsx`     | `player`, `weeklyXp`                     | `GET /v1/players/me`, `GET /v1/streak/weekly`                  |
| `(tabs)/profile.tsx`      | `player`                                 | `GET /v1/players/me`                                           |
| `game/word.tsx`           | `liveBoard`, `tracks`                    | local level row + `GET /v1/progress`                           |
| `game/sentence.tsx`       | `liveBoard`, `tracks`                    | same                                                            |
| `game/success.tsx`        | `liveBoard`                              | `POST /v1/runs` response (local prediction first)              |
| `game/complete.tsx`       | `completion`                             | `POST /v1/runs` response                                        |
| `streak.tsx`              | `player`, `weekdays`                     | `GET /v1/streak`                                                |
| `leaderboard.tsx`         | `countryBoard`, `globalBoard`, `player`  | `GET /v1/leaderboard`                                           |
| `shop.tsx`                | `freePoints`, `player`, `shopPowers`     | `GET /v1/shop/catalog`, `GET /v1/quests`                        |
| `settings.tsx`            | `player`                                 | `GET /v1/auth/me` — and **"Not signed in" when `isAnonymous`**  |
| `otp.tsx`                 | `player`                                 | the email passed in params; drop the mock fallback              |
| `country.tsx`             | `countries`                              | `GET /v1/reference`                                             |
| `languages.tsx`           | `learnLanguages`                         | `GET /v1/reference`                                             |
| `age.tsx`                 | `ageGroups`, `interests`                 | `GET /v1/reference`                                             |
| `milestones.tsx`          | `milestones`                             | **deferred** — stays on mock in v1                              |
| `achievements.tsx`        | `achievements`                           | **deferred** — stays on mock in v1                              |
| `referral.tsx`            | `player`, `referrals`, `referralStats`   | **deferred** — stays on mock in v1                              |

`otp.tsx` currently falls back to `player.email` when no email param is present. That is a
mock artifact that would show a stranger's address in production; remove the fallback rather
than repointing it.

## Sync orchestration

```
app launch
  → read token from secure store; if none, POST /api/auth/sign-in/anonymous
  → render immediately from SQLite (never await the network)
  → in background: manifest → level delta if needed → GET /v1/progress?since= → drain outbox

level finishes
  → recordProgress() locally, render success screen from the local prediction
  → POST /v1/runs; on success, reconcile the server's answer into SQLite
  → on failure, write to the outbox and carry on — this is normal, not an error

app foreground / connectivity regained
  → drain outbox via POST /v1/progress/sync
  → refresh progress, wallet, streak, quests

app background
  → flush saved-run snapshots
```

Use TanStack Query — already configured in `src/lib/query-client.ts` with `retry: 1` and a
30s stale time — for every read. Mutations go through the outbox rather than through
`useMutation` directly, because a mutation that only exists in React state dies with the
process.

## What must not regress

- Cold start with no network reaches the map with no spinner and no error toast.
- A finished level shows the success screen instantly, offline.
- Guests continue to reach the map in one tap from `auth.tsx`.
- The pause sheet, resume prompt and level map behave exactly as they do today.

## Suggested order

Mirrors the [rollout stages](../07-platform/03-testing-rollout.md):

1. Auth client + anonymous sign-in + secure token storage. Nothing else changes.
2. Level sync. The pack updates from the server; gameplay is untouched.
3. Outbox + run submission, **logging** the response without applying it. This is where
   prediction drift surfaces.
4. Apply server rewards; wire the wallet, streak and quest screens.
5. Leaderboards.
6. Delete `src/data/mock.ts`, minus the three deferred screens.
