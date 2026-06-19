# Out-of-stock–aware procurement planning

**Branch:** `claude/oos-aware-planning`
**Status:** Spec / not yet implemented
**Author:** (drafted with Claude)

## Problem

Today a buyer only discovers an item is out of stock at the very end of the
flow — after clicking **Build cart**, when they open the supplier's product page
and find it unavailable (see the Build-cart leftovers modal). By then they've
already committed to a supplier mix. We want to surface availability **during
procurement planning** and let the buyer move an out-of-stock line to the
next-best in-stock supplier with one click, before the handoff is frozen.

## Goals

- Show each plan line's availability inline (not just on the PDP).
- When a line's chosen supplier can't fulfill it, offer a one-click switch to the
  next-best **in-stock** offer, honoring the active buying strategy.
- Provide a bulk "reassign all out-of-stock items" action.
- Never let an unavailable line silently land in a supplier handoff.
- Keep the buyer in control — recommend the swap, don't auto-apply it silently.

## Non-goals (this spec)

- Real-time stock for non-Shopify suppliers (NetSuite/ASP/etc.) — no live feed
  exists; we rely on ingestion availability for those.
- Variant-level SKU→Shopify-variant matching correctness (a real but separable
  bug; see [Follow-ups](#follow-ups)).
- Backorder ETA / lead-time modeling.

---

## What already exists (reuse, don't rebuild)

| Capability | Where |
|---|---|
| `availability` enum on price snapshots: `in_stock \| limited \| backordered \| unknown` | `medusa-backend/apps/backend/src/modules/medmkp/models/supplier-price-snapshot.ts:12` |
| Availability surfaced on **search** offers | `.../api/medmkp/products/search/route.ts:86,176` |
| FE pill helper `availabilityInfo(value)` (in_stock→ok, limited→warn, backordered→bad, else muted) | `app/page.jsx:2462` |
| Per-line offer override `selectedOfferKey` + ranked `offers[]` per row | `app/page.jsx:4239-4240` |
| Offer detail drawers (radio pick among candidates → `onConfirmMatch({selectedOfferKey})`) | `app/page.jsx:4420-4630`, `4888-5000` |
| Strategy-aware best-offer pick `pickBestOffer(offers, prefs, item)` | `app/page.jsx:3974` |
| Optimizer + candidate pool for bulk reassignment `optimizeLandedAssignment` / `candidatePool` | `app/page.jsx:4077`, `~4126` |
| Plan "included vs unresolved" partition | `app/page.jsx:2061` (`ProcurementPlanView`) |

### The gap

`availability` reaches the **PDP** (via the search route) but **not** the
reorder-list / plan rows, because the **match** path drops it at two layers:

1. **Backend match offer** — `buildOffers()` / the candidate SQL in
   `medusa-backend/apps/backend/src/matching/line-items.ts:~303-340` selects
   `price.price_cents` but **not** `price.availability`, and `OfferView` has no
   availability field.
2. **Proxy** — `toOffer()` in `app/api/requests/route.js:49` maps `imageUrl` and
   `productUrl` but **not** `availability`.

So the whole feature begins with a thin plumb of one existing field.

---

## Key design decision: orderability semantics

The snapshot enum and the live Shopify check don't line up 1:1, and most of the
catalog is `unknown`. Define a single helper so every consumer agrees:

```js
// "Can the buyer order this right now?" — conservative: only an explicit
// negative signal blocks. Unknown stays orderable so we don't nuke the catalog.
function isOrderable(offer) {
  if (offer.liveAvailable === false) return false;   // live Shopify check wins
  if (offer.availability === "backordered") return false;
  return true;                                        // in_stock | limited | unknown
}
```

| `availability` | Orderable? | Plan-row badge |
|---|---|---|
| `in_stock` | ✅ | none (quiet) |
| `limited` | ✅ | "Limited stock" (warn, amber) |
| `unknown` | ✅ | none on row; "Check with supplier" only inside the drawer |
| `backordered` | ❌ | **"Out of stock"** (bad, red) → triggers switch |
| live `available:false` (Phase B) | ❌ | **"Out of stock"** (bad, red) → triggers switch |

Rationale: `unknown` dominates the catalog (many adapters don't report stock),
so treating it as "not orderable" would flag almost everything. Only an explicit
`backordered` or a live negative blocks.

---

## Architecture / data flow

```
ingestion ──► price_snapshot.availability
                     │
   match SQL (line-items.ts)  ──►  OfferView.availability        [Phase A: backend plumb]
                     │
   /api/requests toOffer       ──►  offer.availability            [Phase A: proxy plumb]
                     │
   match-row mapping (page.jsx) ──► row.offers[].availability
                     │                row.availability (selected offer's)
                     ├──► plan-row badge                          [A3]
                     ├──► pickBestOffer / candidatePool filter    [A5]
                     ├──► per-line "switch to next in-stock"      [A4]
                     ├──► bulk "reassign out-of-stock" banner     [A6]
                     └──► all-OOS → unresolved bucket             [A7]

   (Phase B) Build-cart `.js` live check ──► offer.liveAvailable ──► same switch flow
```

---

## Phase A — Planning (ingestion-driven). The MVP.

This phase fully delivers the requested behavior using data we already collect.
It depends only on `main` (no dependency on the Build-cart branch).

### A1. Backend: emit availability on match offers
`medusa-backend/apps/backend/src/matching/`
- `types.ts`: add `availability: string` to `OfferView` (and to the row/column
  types used by the candidate query).
- `line-items.ts`: add `price.availability` to the snapshot subquery SELECT
  (`~line 305`), carry it through `toRow`, and set
  `availability: memberRow.availability ?? "unknown"` in `buildOffers()`
  (`~line 320-340`).
- Tests: extend the matching unit spec so a backordered snapshot surfaces
  `availability: "backordered"` on the offer.

> Note: the **search** route already does this; we're bringing the match route to
> parity.

### A2. Proxy + row plumbing
- `app/api/requests/route.js` `toOffer()` (`:49`): add
  `availability: offer.availability || "unknown"`.
- `app/page.jsx` match-row mapping (`~:4239`): include `availability` on each
  entry of `offers[]`, and compute a row-level
  `availability = chosen?.availability ?? best?.availability ?? "unknown"` so the
  row knows its **selected** offer's status. Also carry `availability` in
  `offerKey`-adjacent fields and in `slimHandoffRow` so the frozen handoff keeps
  it.

### A3. Plan-row availability badge
- Render the `availabilityInfo(row.availability)` pill on each plan/reorder row
  (the live `ProcurementPlanView` rows and the supplier-group rows), reusing the
  existing pill tones. Only `limited` (amber) and `backordered`/out-of-stock
  (red) show a badge; `in_stock`/`unknown` stay quiet.
- Stamp the red/amber badge with a hover title: "Stock as of last sync — verify
  before ordering" to set expectations about freshness.

### A4. Per-line "switch to next in-stock"
- On any row where `!isOrderable(selectedOffer)`, render an inline action:
  > 🔴 Out of stock at {supplier} · **Switch to {nextSupplier} — ${price}**
- The target = `pickBestOffer(orderableOffers, prefs, item)` where
  `orderableOffers = row.offers.filter(isOrderable)`. Clicking sets
  `selectedOfferKey` to that offer's key via the existing
  `onConfirmMatch(itemId, { selectedOfferKey })` path. The row re-groups under the
  new supplier; totals/savings/landed-cost recompute automatically.
- In both detail drawers (`:4420-4630`, `:4888-5000`): annotate each candidate
  with its `availabilityInfo` pill, sort orderable-first, and visually mark
  non-orderable candidates (still selectable, for an intentional backorder).

### A5. Make availability a selection constraint
- `pickBestOffer` (`:3974`): before cost sort, prefer `offers.filter(isOrderable)`;
  fall back to the full pool only if none are orderable (so a line is never left
  with no recommendation).
- `candidatePool` (`:4077`, used by `optimizeLandedAssignment`): same filter, so
  the optimizer naturally routes baskets around out-of-stock offers.

### A6. Bulk reassign banner
- Mirror the existing optimizer "Apply" card pattern: when ≥1 included line is
  out of stock at its selected supplier, show
  > **{n} items are out of stock — reassign to the next in-stock supplier.** [Apply]
- Apply iterates those lines and sets each `selectedOfferKey` to its A4 target in
  one state update. Recompute summary after.

### A7. All-offers-out-of-stock → unresolved
- If `row.offers.filter(isOrderable)` is empty, classify the line as
  "Out of stock everywhere" and route it into the existing unresolved bucket
  (`ProcurementPlanView`, `:2061`) with a "keep as backorder / remove" choice, so
  it can't silently enter a handoff. `prepareHandoff` should exclude it unless the
  buyer explicitly keeps it.

---

## Phase B — Confirmation (live-driven). Follow-on.

Ingestion availability is advisory and stale; the live Shopify `.js` check is the
truth for Shopify suppliers. Phase B closes the gap and connects to the existing
Build-cart work.

- Extract the Shopify variant/availability resolver (currently in the Build-cart
  branch's `app/api/cart-link/route.js` `resolveShopifyVariant`) into a shared
  helper, returning `{ available }` per line.
- **Automatic** live check on plan open (decision #3): on entering the plan, fire
  a bounded, Shopify-only live check of each line's **selected** offer, set
  `offer.liveAvailable`, and re-render badges. A live `available:false` flows
  through the **same** `isOrderable` → A4 switch flow. Bound the cost: only
  selected (not alternative) Shopify offers, dedupe by product URL, cap
  concurrency, short per-request timeout (reuse the 8s in `cart-link`), and cache
  the result for the session so re-opening the plan doesn't re-hammer. Degrade
  silently to the ingestion badge if the check fails/times out.
- The existing Build-cart leftovers modal becomes one surfacing of this signal:
  out-of-stock leftovers there should offer the same "switch to next in-stock"
  action instead of a dead "open it yourself" link.

---

## Out of scope / Follow-ups

- **Variant-SKU correctness:** `resolveShopifyVariant` grabs *any* in-stock
  variant (`inStock || variants[0]`) rather than the one matching the line's SKU.
  For products with size/color variants this can add the wrong variant or report
  the wrong availability. Fix by matching the line's SKU/title to the specific
  variant. Tracked separately.
- Freshness UX: optionally a lazy live re-check of just the selected offers when
  the plan opens (bounded N, Shopify-only) so badges aren't purely as-of-sync.

---

## File-by-file change list (Phase A)

**Backend**
- `medusa-backend/apps/backend/src/matching/types.ts` — `OfferView.availability`.
- `medusa-backend/apps/backend/src/matching/line-items.ts` — select + carry +
  emit `availability`.
- `medusa-backend/apps/backend/src/matching/__tests__/matching.unit.spec.ts` —
  coverage.

**Frontend**
- `app/api/requests/route.js` — `toOffer` carries `availability`.
- `app/page.jsx` — match-row mapping (`availability` on offers + row), `isOrderable`
  helper, `pickBestOffer` + `candidatePool` filters, plan-row badge, per-line
  switch, bulk banner, all-OOS unresolved routing, `slimHandoffRow` passthrough.
- `styles.css` — badge + switch-action + banner styles (reuse existing pill/Apply
  card classes where possible).

No DB migration required — `availability` already exists on the snapshot.

---

## Build & verification order

1. **A1 backend** → verify: POST `/medmkp/invoices/match` for a backordered item
   returns `availability` on the offer (curl against local stack / prod read).
2. **A2 plumb** → verify: a matched plan row carries `availability` end to end.
3. **A3 badge** → verify live (`/browse`, forged session): backordered line shows
   the red badge, in-stock/unknown stay quiet.
4. **A4 + A5 switch/filter** → verify: clicking switch re-groups the line to the
   next in-stock supplier; recommendation never points at a backordered offer.
5. **A6 bulk** → verify: banner reassigns all OOS lines in one click; totals update.
6. **A7 unresolved** → verify: an all-OOS line is excluded from the prepared
   handoff unless kept.

**Success criteria:** a plan containing a backordered line shows it as out of
stock, recommends and (on click) applies the next in-stock supplier, the bulk
action clears all of them, and `prepareHandoff` never freezes an unavailable line
the buyer didn't explicitly keep.

## Resolved decisions

1. **Recommend + one-click apply** (buyer-driven). No silent auto-reassignment. ✅
2. **`limited`** shows an amber badge but stays orderable and recommendable. ✅
3. **Phase B trigger: automatic** live check on plan open — bounded/throttled/
   cached (see Phase B), not a manual "Verify stock" button. ✅
