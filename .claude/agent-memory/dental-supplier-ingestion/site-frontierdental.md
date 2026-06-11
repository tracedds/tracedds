---
name: site-frontierdental
description: frontierdental.com is Cloudflare-blocked (403 for all non-interactive clients) — do not retry scraping, needs feed/CSV
metadata:
  type: reference
---

frontierdental.com (Frontier Dental) — checked 2026-06-11. NOT ingestible.

- Cloudflare bot management returns 403 "Sorry, you have been blocked" for the
  homepage, sitemap.xml, and all pages, for both plain fetch (pipeline UA) and
  headless Chromium (gstack browse). Only robots.txt returns 200.
- robots.txt: Cloudflare managed content signals — `User-agent: *` Allow: / with
  `Content-Signal: search=yes, ai-train=no`; ClaudeBot/GPTBot/CCBot etc.
  explicitly disallowed.
- Decision: do not attempt to bypass. Paths forward (user to decide): request a
  catalog feed / dealer API from the supplier, or manual CSV import via
  `npm run supplier:import-csv`. No adapter was written.
