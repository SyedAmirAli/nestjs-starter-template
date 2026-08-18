# 01.1 · Anonymous device accounts

**Goal:** every install has a real server-side account from its first launch, whether or
not the player ever signs up.

## Why

`mobile-app/src/app/auth.tsx` offers "Continue as guest" as a first-class choice, and
`src/session/session.ts` already models `'member' | 'guest'` with a documented
`upgradeGuestToMember()` that says, in its own comment, that the two "will differ once a
guest's local progress has to be migrated to a real account".

If guests have no server identity, then every guest feature — cloud backup of progress,
appearing anywhere, syncing to a second device, even a support conversation about lost
progress — has to be built twice, once for guests and once for members. Issuing a real
anonymous account instead means there is exactly one code path: **every request has a
`userId`.** Sign-up stops being "start syncing" and becomes only "attach an email to the
account you already have", which is a far smaller and far safer operation.

## Design

Use Better Auth's `anonymous()` plugin rather than hand-rolling device accounts. It mints a
normal `user` row flagged `isAnonymous`, issues a normal session, and — critically —
provides the `onLinkAccount` hook that fires when an anonymous user signs in for real. That
hook is where [the merge](02-guest-merge.md) runs.

### Schema

```prisma
model User {
  // …existing fields unchanged…

  /// Set by Better Auth's anonymous plugin. An anonymous user is a real account with no
  /// verified identity attached: it can play, sync and earn, but cannot appear on a
  /// leaderboard or be recovered if the device is lost. Cleared when the account is linked
  /// to an email or Google identity.
  isAnonymous Boolean @default(false)

  @@index([isAnonymous])
}
```

`Verification` already exists and is what the plugin uses; no other table changes.

### Auth wiring — `src/auth/auth.ts`

```ts
import { anonymous } from 'better-auth/plugins';

plugins: [
    expo(),
    bearer(),
    emailOTP({ /* unchanged */ }),
    anonymous({
        emailDomainName: 'anon.glowquest.app',
        onLinkAccount: async ({ anonymousUser, newUser }) => {
            await queue.add(QueueName.GuestMerge, {
                fromUserId: anonymousUser.user.id,
                toUserId: newUser.user.id,
            });
        },
    }),
],
```

Add `isAnonymous` to `user.additionalFields` with **`input: false`**, exactly as `role`
already is. A client that could set `isAnonymous: false` on itself would promote its own
guest account to leaderboard-eligible without ever verifying an identity.

`user.create.after` already upserts `UserMeta` for every new user, so anonymous accounts get
settings seeded with no change. Add the game-side seed (a `PlayerProfile` and a `Wallet`
row) to the same hook — see [03-player-profile.md](03-player-profile.md).

### Client flow

```
first launch
  → POST /api/auth/sign-in/anonymous
  → store the bearer token from `set-auth-token` in expo-secure-store
  → every subsequent request carries it
```

The token is the device's identity. It is stored in **secure storage, not the kv-store**
that `src/session/session.ts` uses — that file's own docblock already says real credentials
belong beside it in secure storage, and this is that moment.

`session.ts`'s `status` becomes a projection of the account, exactly as its comment
anticipates: `member` when `isAnonymous === false`, `guest` when `true`.

## Endpoints

| Method | Path                             | Auth   | Purpose                                          |
| ------ | -------------------------------- | ------ | ------------------------------------------------ |
| `POST` | `/api/auth/sign-in/anonymous`    | public | Better Auth. Creates the account, returns a token.|
| `GET`  | `/v1/auth/me`                    | any    | Existing. Extended to include `isAnonymous`.      |

`GET /v1/auth/me` response gains one field:

```jsonc
{
  "user": { "id": "…", "name": "Player", "email": "anon-…@anon.glowquest.app",
            "emailVerified": false, "isAnonymous": true, "createdAt": "…" },
  "settings": { "theme": "SYSTEM", "locale": "en", "timezone": "Asia/Dhaka", … }
}
```

The app must treat the synthetic anonymous email as **not displayable**. `settings.tsx`
currently renders `player.email` directly; it needs to render "Not signed in" when
`isAnonymous`.

## Failure modes to handle explicitly

**Token lost, no identity attached.** The account is unrecoverable. This is inherent to
anonymous accounts and is precisely why `guest-prompt.tsx` exists in the app. The server's
obligation is to make the consequence legible, not to prevent it: `GET /v1/auth/me` returns
`isAnonymous: true`, and the app's existing once-per-launch nudge says what is at risk.

**A device creates accounts in a loop.** Rate-limit anonymous sign-in to 5 per IP per hour
and 1 per device install. Orphaned anonymous accounts with zero runs and no session in 30
days are deleted by the housekeeping job — otherwise the `user` table becomes a log of
every app open.

**Two devices, one guest.** Not supported, by definition — there is no identity to join
them on. The app should say "sign in to play on another device" rather than appearing
broken.

## Tasks

1. Add the `anonymous` plugin, `isAnonymous` additional field (`input: false`) and schema column; migrate.
2. Extend `AuthService.getCurrentUser` to project `isAnonymous`.
3. Add the anonymous sign-in rate limit to the auth-audit middleware path.
4. Add the orphan sweep to `QueueName.AccountDelete`'s cron (30 days, zero runs, no active session).
5. Extend `src/auth/protected-users.ts` so an anonymous account can never hold `ADMIN`.

## Definition of done

- A fresh install with no user interaction has a `userId` and can `POST /v1/runs`.
- `GET /v1/auth/me` reports `isAnonymous: true` for it.
- Signing in with email on that install fires `onLinkAccount` exactly once.
- e2e: anonymous sign-in → submit run → sign in with OTP → progress still present.
