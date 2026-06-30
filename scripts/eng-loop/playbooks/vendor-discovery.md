### Playbook: new-vendor discovery vs Net32 (files issues)

Goal: find ONE high-value dental-supply vendor that **sells on Net32 but that we do
not yet ingest as a direct supplier**, recon its own website for ingestibility, and
file **one** `vendor-candidate` issue with the recon + a verdict. This is the input
queue for the `vendor-ingestion` playbook (which turns a good candidate into an
adapter PR). Most ticks produce **one issue, never a PR** — discovery is read-only.

**Hard limits:** read-only prod SQL + read-only web recon only. **Never** mutate prod,
never `--commit`, never seed suppliers. **At most one issue per tick.**
`DATABASE_URL` (read-only prod) is set in your environment.

**Framing — Net32 sellers are not suppliers (yet).** Net32 is a marketplace we ingest
as a **single** aggregator supplier (`msup_net32`); the underlying winning seller
(e.g. "Frontier Dental Supply", "Pearson Dental") is captured only inside each row's
`raw_text` JSON, key `net32_vendor`. So "vendors we could add" = Net32 sellers that we
do **not** already ingest as **direct distributors**. Diff against the direct set, not
against `msup_net32`.

#### Where things live
- **Net32 winning-seller per product:** `medmkp_supplier_product.raw_text` (a TEXT column
  holding `JSON.stringify(raw)`), JSON key `net32_vendor`, rows where `supplier_id =
  'msup_net32'`. Because it's text, cast it: `(raw_text::jsonb)->>'net32_vendor'`.
- **The direct-distributor set we already ingest** (the diff target):
  - `medmkp_supplier` table (read-only SQL): `name`, `slug`, `website_url`.
  - `medusa-backend/apps/backend/data/supplier-vetting/*.json` (`slug`, `website_url`).
  - `medusa-backend/apps/backend/src/ingestion/supplier-pipeline/adapters/index.ts`
    (the adapter `id`s already wired in).

#### 1. Census Net32 sellers (the data)
Read-only SQL (`psql "$DATABASE_URL"`), ranked by how often each seller is the
**winning** offer — a built-in value/breadth signal:
```sql
SELECT (raw_text::jsonb)->>'net32_vendor' AS vendor, count(*) AS wins
FROM medmkp_supplier_product
WHERE supplier_id = 'msup_net32'
  AND raw_text IS NOT NULL
  AND (raw_text::jsonb)->>'net32_vendor' IS NOT NULL
GROUP BY 1 ORDER BY wins DESC;
```
(Some `raw_text` rows may not be valid JSON — wrap the cast defensively or filter with
`raw_text LIKE '{%'` if a row errors. Keep it read-only.)

#### 2. Diff against what we already ingest
- Pull our direct set: `SELECT name, slug, website_url FROM medmkp_supplier WHERE
  deleted_at IS NULL;` plus the slugs in `data/supplier-vetting/*.json` and the adapter
  `id`s in `adapters/index.ts`.
- Normalize names for the match (lowercase; strip `dental`/`supply`/`inc`/`llc`/`co`).
  Drop Net32 sellers we **already** have a direct supplier/adapter for.
- Also drop the ones we deliberately treat as **identity-only / price-gated** (Patterson,
  Henry Schein) — note them, but they are not direct price sources, so don't propose them.

#### 3. Pick ONE candidate and recon its site (read-only)
Take the highest-`wins` seller we don't ingest. Find its own website (search), then recon
with `/browse` / `curl` and establish the facts **by eye** (you're multimodal — don't
trust a listing's claims):
- **Prices visible logged-out?** (gated → identity-only, lower value.)
- **Per-product identifiers:** SKU, manufacturer SKU / MPN, **GTIN/UPC barcode**? (the
  barcode slot is the lot/expiry traceability hook — high value.)
- **Platform → which adapter pattern:** Shopify (`/products/<handle>.json`,
  `products.json`) → reuse `adapters/shopify.ts`; BigCommerce (`var BCData`) → like
  `adapters/practicon.ts`; WooCommerce / JSON-LD `Product` / custom HTML → like
  `adapters/pearson.ts`, or a new adapter.
- **Catalog discoverability + size:** `sitemap.xml`? a product feed (`xmlsitemap.php`,
  `products.json`)? rough product count.
- **Bot protection:** Cloudflare / captcha? (hard-gated → may need the NUC headful path
  like Net32; flag it.)

#### 4. File ONE `vendor-candidate` issue
- **Dedup first:** `gh issue list --repo <repo> --label vendor-candidate --state open
  --search "<vendor>"` — if it already exists, **stop (no duplicate).**
- **Soft backpressure:** if there are already **≥ 5 open** `vendor-candidate` issues, skip
  this tick (quiet) — let `vendor-ingestion` drain the queue before adding more.
- **Ensure the label exists:** `gh label create vendor-candidate --repo <repo>
  --color 0e8a16 --description "Net32 seller we could ingest as a direct supplier"
  2>/dev/null || true`.
- `gh issue create --label vendor-candidate --label eng-loop` with: the vendor name +
  its Net32 `wins` count, homepage, the **recon table** (prices logged-out? ids
  sku/mpn/upc? platform → which adapter to reuse? catalog size + sitemap/feed? CF-gated?),
  an **ingestibility verdict** (`ingestible-now` / `needs-headful` / `identity-only` /
  `skip`, with one line of why), and the **concrete next step** for `vendor-ingestion`
  (which existing adapter to clone, where the product JSON/feed lives). This issue body
  is what the ingestion playbook reads — make it actionable.

#### If nothing
If every high-`wins` Net32 seller is already ingested, or the top candidates are all
CF-gated / identity-only, a **quiet tick is fine** — file nothing.
