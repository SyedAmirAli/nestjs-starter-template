# 08.4 · Client gameplay — board engine, HUD and feedback

**Goal:** land timers, hearts and typed powers in the app without changing how the puzzle
feels to a player who never meets either.

## The board engine change, and why it is the delicate one

`useBoard.ts` today validates **only when every slot is filled**:

```ts
if (next.length === target.length) {
  const ok = next.every((ix, k) => pool[ix] === target[k]);
  if (ok) setSolved(true);
  else { setShake(true); /* clear after 620ms */ }
}
```

So "a wrong selection" as a discrete event does not exist. Two ways to introduce it, and the
choice decides how the game feels:

- **Per tile** — check each placement immediately. Responsive, but the board now tells you
  the instant you are off-track, which makes every puzzle substantially *easier* and would
  collapse the 3★ time thresholds.
- **Per attempt** — a heart is lost when a full arrangement is submitted and is wrong: the
  existing shake-and-clear moment, which is already an event with animation, timing and a
  natural place to hang feedback.

**Per attempt is the decision.** Today's puzzle feel is preserved exactly, hearts read
naturally as "three wrong tries", and the implementation is a hook into a branch that already
exists rather than a rewrite of `place()`.

```ts
// useBoard.ts — the only change to the solve path
} else {
  setShake(true);
  onWrongAttempt?.();          // ← hearts, haptics, sound hang here
  clearTimer.current = setTimeout(() => { setSlots([]); setShake(false); }, 620);
}
```

Everything else in `place()`, `undo()`, `hydrate()` and `reset()` is untouched.

## New client modules

| File                                | Purpose                                                                 |
| ----------------------------------- | ----------------------------------------------------------------------- |
| `src/game/timer.ts`                 | `TimerController` — deadline-based, `addMs` / `freeze` / `setRate`      |
| `src/game/hearts.ts`                | Heart state, loss, restore, shield absorption                           |
| `src/game/constraints.ts`           | `resolveConstraints(level, progress)` — **must mirror the server exactly** |
| `src/game/powers/registry.ts`       | `registerPower(code, handler)` + the effect context                     |
| `src/game/powers/effects/*.ts`      | One file per power                                                      |
| `src/game/attempt.ts`               | Attempt state machine: `RUNNING → SOLVED | TIMEOUT | HEARTS_DEPLETED`   |
| `src/components/gq/timer-bar.tsx`   | The countdown display and its three phases                              |
| `src/components/gq/heart-row.tsx`   | The heart display                                                       |
| `src/components/gq/power-dock.tsx`  | The power controls                                                      |

`src/game/rewards.ts` gains the timed-star branch and stays under the parity fixture.

### The timer must be deadline-based

The current `setInterval(() => setElapsed(t => t + 1), 1000)` accumulator cannot be reused:
intervals do not run reliably when the app is backgrounded, accumulated ticks drift, and
`addMs` against an accumulator races the tick. Store `deadlineAt`, derive
`remainingMs = deadlineAt - Date.now()`, and use the interval only to drive rendering.

Returning from background then recomputes the truth instead of resuming a stale count — and
handling that is not optional, because a phone call mid-level is a normal event.

`useBoard`'s existing `paused` prop (already used by the pause sheet) is the same mechanism
`FREEZE_TIME` uses. Reuse it; do not invent a second pause.

## HUD

```
┌─────────────────────────────────────────────┐
│  ‹     ⏱ 00:42            ❤ ❤ 🖤       ⚙   │   ← game-chrome.tsx
├─────────────────────────────────────────────┤
│                                             │
│              [ the board ]                  │
│                                             │
├─────────────────────────────────────────────┤
│   [💡 3]  [↩ Undo]  [🔀 5]  [+10s 2]        │   ← power dock
└─────────────────────────────────────────────┘
```

- The timer and hearts live in `game-chrome.tsx`, which already owns the top bar. Neither is
  rendered when its constraint is off — an untimed, heartless level looks **exactly like the
  game does today**, which is the acceptance criterion for the whole phase.
- The power dock sits below the board and never overlaps it. Unavailable-by-structure powers
  are hidden; unavailable-by-balance powers stay visible with a buy affordance.
- Every count is on the control itself, so "can I afford this" needs no second screen.

### Timer phases

| Phase      | Threshold          | Treatment                                              |
| ---------- | ------------------ | ------------------------------------------------------ |
| `NORMAL`   | > 50% remaining    | Quiet. Body text weight, no motion.                    |
| `WARNING`  | 20–50%             | Colour shift to gold. Still no motion.                 |
| `CRITICAL` | < 20% or < 10s     | Coral, gentle pulse at 1 Hz, tick audio if sound is on. |

The design asks that the timer not be distracting during normal play, and the way to honour
that is to keep `NORMAL` visually inert — no ticking, no motion, no colour. Escalation only
means something if the baseline is calm.

Phase thresholds are proportional so a 90-second and a 35-second level escalate at the same
*felt* moment.

## Feedback

Existing pieces to build on: `components/gq/anim.tsx` has `Float`; `theme/tokens.ts` has the
gradients and `drop()` shadows; `audio/coordinator.ts` already ducks music for pronunciation
audio and is the right place to route effect sounds.

| Event              | Visual                                        | Haptic            | Sound        |
| ------------------ | --------------------------------------------- | ----------------- | ------------ |
| Correct placement  | Existing tile snap                            | `selection`       | soft tick    |
| Wrong attempt      | Existing 620ms shake                          | `notificationError` | thud       |
| Heart lost         | Heart drains to 🖤, scale 1 → 1.25 → 1        | `impactMedium`    | with the thud |
| Last heart lost    | Full-screen desaturate, hearts flash          | `notificationError` | descending  |
| Timer → WARNING    | Colour transition only                        | none              | none         |
| Timer → CRITICAL   | Colour + 1 Hz pulse                           | none              | tick loop    |
| Time added         | `+10s` rises from the timer, gold particles   | `impactLight`     | chime        |
| Timer expired      | Timer collapses, board dims                   | `notificationError` | expiry      |
| Restart            | Board reassembles, 400ms                      | none              | soft riser   |
| Solve              | Existing success                              | `notificationSuccess` | existing |

Two rules the design implies and that are worth stating as rules:

- **Nothing above blocks input for more than 620ms** — the shake duration that already
  exists. Failure feedback that outlasts the player's patience turns a retry into a wait.
- **No haptic on a timer phase change.** The timer changes phase without the player doing
  anything, and a device that buzzes on its own reads as a notification, not as feedback.

### Settings must be wired first

`settings.tsx` has `sound` and `haptics` toggles that are **local `useState`** — they do not
persist and are not read anywhere:

```tsx
const [sound, setSound] = useState(true);
const [haptics, setHaptics] = useState(true);
```

Shipping haptics before persisting these means a player who turns haptics off gets buzzed
again on the next launch. Move both into the kv-store the music and reminder systems already
use (`audio/storage.ts`, `reminder/reminder.ts` both follow the pattern), and have every
feedback call read them. Add a **reduce-motion** preference at the same time, honouring the
OS setting by default — a 1 Hz pulse on a critical timer is exactly the motion some players
need to turn off.

## Attempt state machine

```
        ┌──────────────────────────── restart ────────────────────────────┐
        ▼                                                                 │
    RUNNING ──── all slots correct ────────────────────► SOLVED ──────────┤
        │                                                                 │
        ├──── wrong attempt, hearts > 1 ──► (heart lost) ──► RUNNING       │
        ├──── wrong attempt, hearts = 1 ──────────────────► HEARTS_DEPLETED┤
        ├──── remaining ≤ 0 ──────────────────────────────► TIMEOUT ───────┤
        └──── player leaves ──────────────────────────────► ABANDONED
```

Terminal states all do the same three things: freeze the board, submit the run, show the
result. `SOLVED` routes to the existing success screen; `TIMEOUT` and `HEARTS_DEPLETED` show
a failure overlay **on the gameplay screen** and restart in place. The player never returns
to the map, which is what makes it a retry rather than a punishment.

`ABANDONED` is queued and sent with the next sync — never immediately.

## Offline

Unchanged in principle and it must stay that way: the attempt runs entirely on device,
`recordProgress()` writes the local prediction, the success or failure screen renders
instantly, and `POST /v1/runs` goes to the outbox if it fails. Constraints come from the
level row already in SQLite.

The one addition: because consolation XP is *once per level ever*, the client cannot know
locally whether this failure will actually pay. Predict optimistically using local
`consolationPaidAt`, reconcile when the server answers, and — since this is a case where the
optimistic number may be wrong — render the failure XP as "+15 XP" **after** the server
responds where the connection allows, falling back to the local prediction after ~800ms.
A number that appears and then changes is worse than one that appears a moment late.

## Screens touched

| File                              | Change                                                       |
| --------------------------------- | ------------------------------------------------------------ |
| `game/word.tsx`, `game/sentence.tsx` | Wire timer, hearts, power dock, attempt machine            |
| `components/gq/game-chrome.tsx`   | Timer + heart slots in the top bar                            |
| `components/gq/pause-modal.tsx`   | Freeze the timer (already has `paused`); show hearts          |
| `game/success.tsx`                | Show stars from the timed branch where applicable             |
| `game/complete.tsx`               | Unchanged                                                     |
| `powers.tsx`                      | Typed inventory from `GET /v1/powers`; replace `powerCatalog` mock |
| `shop.tsx`                        | Typed grants                                                  |
| `settings.tsx`                    | Persist sound + haptics; add reduce-motion                    |
| `game/resume.tsx`                 | Do not offer a resume for a terminated attempt                |

## Tasks

1. `TimerController` (deadline-based, background-safe) + `timer-bar.tsx` with three phases.
2. `hearts.ts` + `heart-row.tsx`; hook `onWrongAttempt` into the existing shake branch.
3. `constraints.ts` mirroring the server's resolution, including the first-clear rule.
4. Power registry + effect handlers; `power-dock.tsx`; retain free tile-undo.
5. Attempt state machine; failure overlay and in-place restart.
6. Persist sound/haptics; add reduce-motion; route all feedback through them.
7. Extend the local outbox payload with outcome, hearts and `timeGrantedMs`.
8. Tests: per-attempt heart loss, background/foreground timer truthfulness, `addMs` during
   `CRITICAL`, restart clearing the saved run, an untimed heartless level rendering
   byte-identically to today.

## Definition of done

- A level with no timer and no hearts looks and plays exactly as it does now.
- Backgrounding the app for 30 seconds during a timed level consumes 30 seconds, on both platforms.
- Free tile-undo is unchanged.
- Turning off haptics survives a restart.
- Failure never leaves the gameplay screen.
