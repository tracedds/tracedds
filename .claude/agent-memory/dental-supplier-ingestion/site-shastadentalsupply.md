---
name: site-shastadentalsupply
description: shastadentalsupply.com platform facts — no sitemap, ASP.NET crawl paths, adapter + discovery locations, price/markup quirks
metadata:
  type: reference
---

shastadentalsupply.com (Shasta Dental Supply) — verified 2026-06-11.

- Custom ASP.NET WebForms store on IIS. No sitemap: /sitemap.xml 404s, robots.txt
  has no Sitemap directive (only blocks PetalBot/MJ12bot/GPTBot).
- Catalog graph: index.aspx -> show_Categories.aspx?ID= -> show_Subs.aspx?ID= ->
  show_Products.aspx?ID= (product family, multiple SKUs) -> show_Product.aspx?ID=
  (SKU page, richest source: Item Number, Manufacturer, Mfg. Number, Components,
  price with basis suffix "ea./bx./cs./pk.", availability link, breadcrumb,
  description in #tab1). Images at /img_Large.asp?id=<productId>.
- Code: discovery `supplier-pipeline/shasta-catalog-discovery.ts` (BFS crawl,
  capped by --max-shasta-catalog-pages, default 5000); adapter
  `supplier-pipeline/adapters/shasta.ts`.
- Quirks: hidden Add_to_Basket inputs are quoted on family pages but UNQUOTED on
  some single-product pages (name=Product_Price); clearance items strike list
  price (`<s>$57.45 ea.</s>`) and add a "Sale Price:" line — adapter takes sale
  price, keeps list in raw.list_price; clearance listing is show_Products.aspx?C=1;
  clearance pages can lack subcategory/product_line breadcrumb levels.
- Scale estimate: 120-page crawl found 620 SKU URLs and had not exhausted the
  queue; full catalog likely a few thousand SKUs.
- Verified live: 40/40 sample extracted, 0 failures, 0 missing
  sku/manufacturer_sku/brand/name/price/availability.
