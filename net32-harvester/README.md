# net32-harvester

Read-only ingestion sidecar for **Net32** (multi-vendor dental marketplace).

Net32 is Cloudflare-fronted and serves prices from a POST API. Plain
`curl`/`fetch` returns `403 "Just a moment…"` **even from the NUC's US IP and
even with a harvested `cf_clearance` cookie** — Cloudflare binds clearance to the
browser's TLS fingerprint, so the only reliable client is a real browser. This
service holds one long-lived headful Chromium (under `xvfb`) that clears the
challenge once, then drives Net32's internal JSON API via in-page `fetch`:

- enumerate `mpId`s from a search page (every product link is `/ec/<slug>-d-<mpId>`)
- `POST /rest/neo/search/getBestPrice` with batched `mpIds` → winning vendor + price

The Medusa backend's `net32` marketplace provider talks to this over localhost
(`createNet32SidecarFetcher`), so **Playwright never ships in the Render backend**.
The rest of the marketplace pipeline (canonical match → price snapshot → persist)
is reused unchanged.

## Run (on the NUC)

```bash
cd net32-harvester
npm install
npx playwright install chromium          # browser binary (system deps via: sudo npx playwright install-deps chromium)
NET32_HARVESTER_TOKEN=<shared-secret> xvfb-run -a node server.mjs
```

Then point the backend at it and run a dry run:

```bash
export NET32_HARVESTER_URL=http://127.0.0.1:8791
export NET32_HARVESTER_TOKEN=<shared-secret>
npm run marketplace:ingest -- --provider=net32 --seeds-file=./data/marketplace-seeds/top-dental-reorder.txt --concurrency=1 --results=5
# add --commit to persist
```

## Endpoints

| Method | Path                         | Returns |
| ------ | ---------------------------- | ------- |
| GET    | `/health`                    | `{ ok, pages }` |
| GET    | `/search?q=<query>&max=<n>`  | `{ query, blocked, products:[{mpId,url}], bestPriceMap:{ [mpId]: {...} } }` |

## Env

| Var | Default | Purpose |
| --- | --- | --- |
| `NET32_HARVESTER_PORT` | `8791` | listen port |
| `NET32_HARVESTER_HOST` | `127.0.0.1` | listen host |
| `NET32_HARVESTER_TOKEN` | _(none)_ | optional bearer token (must match backend's `NET32_HARVESTER_TOKEN`) |
| `NET32_PROFILE_DIR` | `/tmp/net32-profile` | persistent browser profile (holds `cf_clearance`) |
| `NET32_POSTAL_CODE` | `27513` | postal code for `getBestPrice` shipping context |
| `NET32_UA` | Chrome 131 Linux | user agent (must match the one that cleared the challenge) |

Politeness: searches are serialized (one shared page) — keep backend
`--concurrency=1`. Net32 is a single source we don't control; respect it.
