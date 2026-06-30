### Playbook: new-vendor ingestion adapter (PR + dry-run evidence)

Goal: stand up the **first slice** of a direct-supplier ingestion adapter for ONE new
dental vendor — enough to extract **normalized product rows** from its product pages —
verified by a **local dry-run over real sample pages** plus a **unit test**. The PR is
the **adapter code only**. A human reviews it, then seeds the supplier, wires the DAG,
and runs the real ingest on the NUC. **Nothing in this run touches prod.**

**Hard limits:** read-only web fetch + a **local** dry-run only. **Never** seed suppliers
(do not run `seed-usable-dental-suppliers.ts` against prod), **never** add/enable a DAG
schedule, **never** `--commit`, **never** run the real ingest. This is a **backend-only,
additive** change (new files) — do not change shared extraction in a breaking way (see
common rule 7: backend PRs deploy against the live frontend).

#### Where things live
- **Adapter contract:** `medusa-backend/apps/backend/src/ingestion/supplier-pipeline/types.ts`
  — `SupplierProductAdapter = { id, matches(candidate), extractProduct(candidate, html),
  extractProducts?(candidate, html) }`.
- **Normalized output schema:** `src/ingestion/supplier-catalog.ts` `SupplierCatalogRow` —
  `sku`, `manufacturer_sku`, `barcode` (GTIN/UPC), `brand`, `name`, `description`,
  `category`, `subcategory`, `product_line`, `product_url`, `image_url`, `pack_size`,
  `unit_of_measure`, `price_cents`, `price_basis`, `availability`, `min_quantity`, `raw`.
- **Adapter registry:** `src/ingestion/supplier-pipeline/adapters/index.ts` — add your
  adapter to the array (first whose `matches` returns true wins; `genericAdapter` is the
  fallback).
- **Templates by platform:** `adapters/shopify.ts` (Shopify product JSON),
  `adapters/practicon.ts` (BigCommerce `var BCData`), `adapters/pearson.ts` (HTML / JSON-LD).
- **Vetting JSON:** `data/supplier-vetting/*-catalog-sources.json` — model a new one on
  `sky-shasta-catalog-sources.json` (`supplier_id`, `supplier_name`, `slug`,
  `website_url`, `source_catalog`, `source_type`, `source_url`, `classification`,
  `confidence_score`, `source_company_name`, `notes`).
- **Tests:** `adapters/__tests__/*.unit.spec.ts` — run with `npm run test:unit` from
  `medusa-backend/apps/backend`.

#### 1. Pick the target vendor
- **Prefer an open `vendor-candidate` issue** (filed by `vendor-discovery`):
  `gh issue list --repo <repo> --label vendor-candidate --state open`. Pick the best
  **`ingestible-now`** one (prices logged-out + identifiers + a known platform). Your PR
  will `Closes #<that issue>`.
- If there are none, do a quick census-pick yourself (see `vendor-discovery.md` steps
  1–3) — but only commit to a vendor whose product pages you can actually **fetch and
  parse this tick**.
- **Skip CF-gated / identity-only vendors** (no logged-out prices, or hard bot-walls).
  Those need a human-run headful path — leave the candidate issue open, comment on what
  blocked you, and stop (quiet tick).

#### 2. Reverse-engineer the product page (BEFORE)
- Fetch **5–10 real product page HTMLs** (`curl` / `$B`). Locate where the structured
  data lives — Shopify `products.json` / inline product `<script>`, BigCommerce
  `var BCData`, JSON-LD `Product`, or plain HTML — and map each `SupplierCatalogRow`
  field to its source on the page, especially `sku` / `manufacturer_sku` / `barcode` /
  `price_cents` / `pack_size`.

#### 3. Write the adapter (smallest slice)
- If the platform matches an existing adapter's source format (e.g. Shopify), **prefer
  extending that adapter's `matches`** over a new file. Otherwise add
  `adapters/<vendor>.ts` implementing `SupplierProductAdapter`, and register it in
  `adapters/index.ts` (before `genericAdapter`).
- Add `data/supplier-vetting/<vendor>-catalog-sources.json` (model on the existing one).
- **Add a unit test** `adapters/__tests__/<vendor>.unit.spec.ts`: a captured real HTML
  fixture → the expected normalized row. This is the durable regression layer.
  `npm run test:unit` must pass.

#### 4. Verify with a local dry-run (AFTER) — the evidence
- **Throwaway harness — do NOT commit it** (like the OCR playbook's harness page):
  build `ProductPageCandidate` stubs for your fetched pages, call the new adapter's
  `extractProducts`, and print the resulting `ExtractedProductRow[]`.
- Evidence = an **extraction-rate table** — "N/N sample pages extracted", with the key
  fields populated (`sku` / `manufacturer_sku` / `barcode` / `price` / `pack_size`) —
  mirroring the vetting-JSON house format ("Verified live: 8/8 sample rows extracted, 0
  failures"). Plus `npm run test:unit` green.
- **Be honest:** report the real extraction rate; partial-field misses are fine to note
  as a TODO. **No genuine evidence → no PR** (quiet tick).

#### 5. Open the PR (backend-only)
- Commit the adapter + its `adapters/index.ts` registration + the vetting JSON + the unit
  test (**not** the throwaway harness, **not** `.tracedds/`).
- This is **backend-touching**, so per common rules the Vercel preview does **NOT** reflect
  it — say so and point to the dry-run + test evidence.
- PR "Verification" = the extraction-rate table + `npm run test:unit` output. State
  plainly: **"This PR is the adapter only — nothing ran against prod. To go live a human
  must seed the supplier (`seed-usable-dental-suppliers.ts`), wire a DAG, and run the
  ingest on the NUC."** `Closes #<candidate issue>` if you worked one.

#### If nothing clean
If the target turns out CF-gated, JS-rendered with no JSON feed, or you can't reach a
reliable extraction this tick, open **nothing** (quiet tick) and leave the candidate
issue open with a one-line comment on what blocked it.
