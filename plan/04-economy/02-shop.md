# 04.2 · Shop

**Goal:** back `mobile-app/src/app/shop.tsx` with a server-priced, server-validated,
idempotent purchase flow.

## Scope

**Points only. No real money in v1.** `shop.tsx`'s own header comment says it: "Power shop —
Points only. XP is never purchasable." In-app purchase brings store review, receipt
validation, refunds, tax and a fraud surface — none of which belongs in the release that
first turns the network on. The catalog schema below is shaped so an IAP-backed points pack
is an added `priceKind`, not a rewrite.

The screen shows three tabs — Powers, Points, Bundles — and an "Earn points free" section.
"Points" is empty in v1 (that tab is where IAP lands); "Earn points free" is served by
[daily quests](../05-retention/02-daily-quests.md), not by the shop.

## Schema

```prisma
model ShopItem {
  id String @id @default(uuid(7)) @db.Uuid

  /// Stable machine name the client may key art and analytics off. Prices and titles
  /// change; this does not.
  code String @unique          // POWER_HINT_5, POWER_BUNDLE_ALL_5

  title    String              // "Hint ×5"
  category ShopCategory
  /// Asset key in the client's registry, not a URL — art ships in the binary.
  iconKey  String

  priceKind   PriceKind @default(POINTS)
  pricePoints Int

  /// What the purchase grants. Only currency grants exist in v1; a JSON payload means a
  /// cosmetic or a streak freeze can be added without a migration.
  grants Json                  // { "powers": 5 } | { "freezes": 1 }

  /// Merchandising flags, server-owned so a promotion needs no app release.
  isBest    Boolean @default(false)
  sortOrder Int     @default(0)

  /// Null = unlimited. Per-player lifetime cap, for anything that would be exploitable
  /// bought a hundred times.
  purchaseLimit Int?

  availableFrom DateTime?
  availableTo   DateTime?
  isActive      Boolean @default(true)

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  purchases Purchase[]

  @@index([isActive, sortOrder])
  @@map("shop_items")
}

enum ShopCategory { POWERS  POINTS  BUNDLES }
enum PriceKind    { POINTS  IAP }          // IAP defined now, unimplemented in v1

model Purchase {
  id     String @id @default(uuid(7)) @db.Uuid
  userId String
  itemId String @db.Uuid

  /// Price AT THE TIME OF PURCHASE. A later price change must not rewrite history, and
  /// "why was I charged 400?" has to be answerable.
  pricePaid    Int
  grantsGiven  Json

  /// Idempotency key from the `Idempotency-Key` header. Unique per user.
  idempotencyKey String @db.Uuid

  createdAt DateTime @default(now())

  user User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  item ShopItem @relation(fields: [itemId], references: [id], onDelete: Restrict)

  @@unique([userId, idempotencyKey])
  @@index([userId, createdAt])
  @@map("purchases")
}
```

`onDelete: Restrict` on the item relation is deliberate: retiring an item must not be able
to erase the purchase history that explains a player's balance. Retire by `isActive: false`.

## Endpoints

### `GET /v1/shop/catalog`

```jsonc
{
  "points": 1254,                              // the player's balance, so one call fills the screen
  "categories": [
    { "key": "POWERS", "label": "Powers",
      "items": [
        { "code": "POWER_HINT_5", "title": "Hint ×5", "iconKey": "power.power-hint",
          "pricePoints": 250, "grants": { "powers": 5 }, "isBest": false,
          "affordable": true, "purchasesRemaining": null },
        { "code": "POWER_BUNDLE_ALL_5", "title": "All ×5", "iconKey": "reward.reward-chest-open",
          "pricePoints": 690, "grants": { "powers": 15 }, "isBest": true,
          "affordable": true, "purchasesRemaining": null }
      ] },
    { "key": "POINTS",  "label": "Points",  "items": [] },
    { "key": "BUNDLES", "label": "Bundles", "items": [ … ] }
  ]
}
```

`affordable` and `purchasesRemaining` are computed per player so the client never has to
work out why a button is disabled. Cached per item set in Redis (60s), with the
player-specific fields layered on after the cache read — never cache a balance.

Seed the catalog from `mock.shopPowers` so nothing visibly changes at launch: Hint ×5 / 250,
Reveal ×3 / 400, Shuffle ×10 / 180, All ×5 / 690 (best).

`grants` is a **typed** map per [08-difficulty/03](../08-difficulty/03-power-architecture.md):
`{ "HINT": 5 }`, `{ "ADD_TIME": 3 }`. The earlier single-pool design is superseded, which is
what stops the shop's own labels from lying — "Hint ×5" now grants five hints.

### `POST /v1/shop/purchase`

```
Idempotency-Key: 0192f3a1-…
```
```jsonc
{ "code": "POWER_HINT_5" }
```

The body carries **no price**. The server prices the purchase; a client-supplied price is a
field that does not exist in the DTO and therefore a 400.

```jsonc
// 200
{
  "message": "Purchase complete",
  "localeKey": "created.shop.purchase",
  "status": "normal",
  "data": {
    "purchaseId": "…",
    "item": { "code": "POWER_HINT_5", "title": "Hint ×5" },
    "pricePaid": 250,
    "granted": { "powers": 5 },
    "wallet": { "points": 1004, "powers": 14 }
  }
}
```

In one transaction:

```
1. Idempotency — SELECT by (userId, idempotencyKey). Hit → return the stored result, 200.
2. Load the item. Missing / inactive / outside its window → 404 SHOP_ITEM_UNAVAILABLE.
3. Purchase limit → 409 PURCHASE_LIMIT_REACHED.
4. points >= pricePoints, else 402 INSUFFICIENT_POINTS with { required, available } in meta.
5. Debit points  → LedgerEntry(POINTS, −price, SHOP_PURCHASE, subjectId: purchaseId).
6. Credit grants → LedgerEntry(POWERS, +5, SHOP_PURCHASE, subjectId: purchaseId).
7. Insert Purchase with pricePaid and grantsGiven.
8. Commit. Audit row.
```

Both ledger rows carry the same `subjectId`, so a purchase is one query to explain and one
query to reverse.

`402 INSUFFICIENT_POINTS` uses the envelope's `meta` field — the same mechanism
`api-error.types.ts` documents for checkout stock conflicts — so the app can render "250
needed, 180 available" without parsing a message string.

### `GET /v1/shop/purchases?cursor=&limit=25`

Purchase history. Cursor-paginated.

### Admin

`POST|PATCH /v1/admin/shop/items`, `ADMIN` only, audited. Price and availability changes
take effect on the next catalog cache expiry (60s) — invalidate explicitly on write.

## Rules worth stating

- **Never a partial purchase.** Debit and credit are one transaction. A player who loses
  points and gains nothing is the worst bug this module can have.
- **Never a negative balance.** The debit is guarded by the balance check *inside* the
  transaction, with the wallet row locked (`SELECT … FOR UPDATE`), not by a read beforehand.
  Two concurrent purchases from two devices must not both pass a check made before either
  committed.
- **Retire, never delete.** `isActive: false`.
- **The price is the server's.** Always.

## Tasks

1. `ShopItem`, `Purchase`, `ShopCategory`, `PriceKind` schema; migrate.
2. `scripts/seed-shop.ts` from `mock.shopPowers`.
3. `ShopModule` — catalog, purchase, history; idempotency by `@@unique([userId, idempotencyKey])`.
4. Row-locked debit inside the transaction.
5. Admin CRUD with audit and cache invalidation.
6. e2e: purchase → balances move exactly once; repeat with the same `Idempotency-Key` → identical response, one `Purchase` row; two concurrent purchases with 300 points and a 250 price → exactly one succeeds.

## Definition of done

- No request can set its own price.
- Points can never go negative, under any concurrency.
- Every purchase is explainable from two ledger rows sharing a `subjectId`.
- `shop.tsx` renders with no imports from `src/data/mock.ts`.
