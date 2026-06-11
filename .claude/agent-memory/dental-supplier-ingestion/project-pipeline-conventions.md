---
name: project-pipeline-conventions
description: How medmkp supplier ingestion verification works without a DB, and where pipeline pieces live
metadata:
  type: project
---

Verification path for supplier pipelines without a database: the CSV runner
`npm run supplier:ingest -- --suppliers-csv=<csv> --supplier=<name> --limit=N --debug --debug-output-dir=<dir>`
(from `medusa-backend/apps/backend`). The CSV needs headers
`distributor,website_url,prices`. The default CSV path
`research/dental-suppliers.csv` is NOT tracked in git, so worktrees need an
explicit `--suppliers-csv`.

**Why:** `supplier:ingest:db` requires medusa + Postgres; the CSV runner runs the
same discover/index/extract pipeline standalone and writes
products.csv/failures.csv/summary.json for review.

**How to apply:** for new adapters, follow the established pattern — adapter in
`supplier-pipeline/adapters/<supplier>.ts` registered in `adapters/index.ts`
(before genericAdapter); site-specific crawls as
`supplier-pipeline/<supplier>-catalog-discovery.ts` wired into pipeline.ts index
stage with a `max<Supplier>CatalogPages` option mirrored in both
`run-supplier-ingestion.ts` and `ingest-supplier-catalogs.ts`. Quality gates
require name + (sku or manufacturer_sku) + price + product_url. The unified
schema (SupplierCatalogRow) has NO image field — store image URLs in
`raw.image_urls`. Running `npm install` in the worktree churns
`medusa-backend/package-lock.json` (engines field) — revert it.
