---
name: site-skydentalsupply
description: skydentalsupply.com platform facts — sitemap, JSON-LD products, adapter location, quirks
metadata:
  type: reference
---

skydentalsupply.com (Sky Dental Supply) — verified 2026-06-11.

- Custom PHP storefront ("index.php?section=..." CMS). Single sitemap at
  https://www.skydentalsupply.com/sitemap.xml (declared in robots.txt), ~8,776 URLs,
  ~7,600 of which are `.htm` product pages (framework's `\.htm$` pattern already
  classifies them as products).
- Product pages serve complete schema.org Product JSON-LD in raw HTML (no JS
  needed): name, sku, mpn, brand.name, description, offers.price/availability/url.
  BreadcrumbList microdata gives Home / category / subcategory / [line] / product.
- Adapter: `medusa-backend/apps/backend/src/ingestion/supplier-pipeline/adapters/skydental.ts`.
  Image URLs stored in `raw.image_urls` (unified schema has no image column).
- Quirks: discontinued products return HTTP 410; `/item_promo/` matches the
  generic `/item` product pattern but is rejected by quality gates; some SKUs
  have trailing punctuation (e.g. "F010067."). robots.txt disallows /search_results,
  /quick_order, etc. — product .htm pages are allowed.
- Verified live: 48/50 sample extracted, 0 missing sku/brand/name/price;
  subcategory missing on 4/48, pack_size sparse (43/48 empty).
