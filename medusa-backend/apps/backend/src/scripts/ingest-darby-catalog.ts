import type { MedusaContainer } from "@medusajs/framework"
import { MEDMKP_MODULE } from "../modules/medmkp"
import type MedMKPModuleService from "../modules/medmkp/service"
import { darbyProductExtract } from "../ingestion/supplier-pipeline/adapters/darby"
import {
  discoverDarbyItemUrls,
  DARBY_SITEMAP_INDEX,
} from "../ingestion/supplier-pipeline/darby-catalog-discovery"
import type { ProductPageCandidate } from "../ingestion/supplier-pipeline/types"
import {
  buildSupplierCatalogIngestion,
  type SupplierCatalogRow,
} from "../ingestion/supplier-catalog"
import {
  beginSupplierCatalogReconcile,
  type ReconcileService,
} from "../ingestion/supplier-catalog-reconcile"
import { assertDestructiveDbOperationAllowed } from "../utils/db-safety"

/**
 * Darby Dental catalog ingestion.
 *
 * Darby is a Magento storefront exposing ~35k product pages logged-out via its
 * sitemap, each carrying name, brand, MPN, pack AND a public price (regular /
 * special) plus stock status — so unlike Patterson/Henry Schein this is a
 * priced catalog and writes price snapshots.
 *
 * Stage 1 reads the sitemap index → child sitemaps → numeric product URLs.
 * Stage 2 fetches each item page (concurrency-limited, browser UA, one retry),
 * parses the embedded Magento/GA4 model via the Darby adapter, and STREAMS the
 * rows to the DB in batches via the gap-free reconcile session. Streaming keeps
 * peak memory at one batch + the set of seen ids — the whole-catalog-in-memory
 * path (supplier:ingest:db) loads the full extract plus the entire canonical
 * product list before a single write, the pattern that OOM-killed the first
 * Patterson prod run on the 7 GB NUC.
 *
 * Default run is a DRY RUN; --commit writes (subject to the destructive-DB
 * guard, so a remote/prod DB needs ALLOW_REMOTE_DB_DESTRUCTIVE=true).
 *
 *   yarn darby:ingest                          # dry run, full catalog
 *   yarn darby:ingest -- --max-products=200    # quick sample dry run
 *   yarn darby:ingest -- --commit              # write supplier rows + matches + prices
 */

const SUPPLIER_ID = "msup_darbydental_com"
const SOURCE_CATALOG = "darby-website-public"
const SOURCE_URL = "https://www.darbydental.com"
const DB_CHUNK_SIZE = 500
// How many item pages to fetch+parse+write per streamed batch. Bounds peak
// memory; one batch of rows + its artifacts is all that's held at a time.
const FETCH_BATCH_SIZE = 1000
const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/126.0 Safari/537.36"

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// Browser-UA fetch with one retry; returns "" on failure so the run skips a bad
// page instead of aborting the whole crawl.
async function fetchText(url: string): Promise<string> {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 45000)
      const response = await fetch(url, {
        headers: {
          "User-Agent": BROWSER_UA,
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
        },
        redirect: "follow",
        signal: controller.signal,
      })
      clearTimeout(timer)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return await response.text()
    } catch (error) {
      if (attempt === 2) {
        console.warn(`[darby] fetch failed ${url}: ${(error as Error).message}`)
        return ""
      }
      await sleep(1500)
    }
  }
  return ""
}

// Map an array with a fixed worker pool so we never hold more than `concurrency`
// in-flight requests against Darby.
async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const index = next++
      if (index >= items.length) break
      results[index] = await worker(items[index], index)
    }
  })
  await Promise.all(runners)
  return results
}

function* chunk<T>(items: T[], size: number): Generator<T[]> {
  for (let offset = 0; offset < items.length; offset += size) {
    yield items.slice(offset, offset + size)
  }
}

// Darby prices come off the adapter as dollar strings; the ingestion builder
// expects integer cents.
function cents(value: string | undefined): number | undefined {
  if (!value?.trim()) return undefined
  const dollars = Number(value.replace(/[$,\s]/g, ""))
  return Number.isFinite(dollars) ? Math.round(dollars * 100) : undefined
}

function candidateFor(url: string): ProductPageCandidate {
  return {
    distributor: "Darby Dental",
    website_url: SOURCE_URL,
    origin: SOURCE_URL,
    prices: "Y",
    sitemap_url: DARBY_SITEMAP_INDEX,
    url,
    url_type: "product",
    confidence_score: 90,
    reasons: ["darby sitemap product URL"],
    category: "",
    subcategory: "",
  }
}

function parseArgs() {
  const args = process.argv.slice(2)
  let commit = false
  let allowShrink = false
  let maxProducts = Infinity
  let concurrency = 8
  let throttleMs = 0

  for (const arg of args) {
    if (arg === "--commit") commit = true
    else if (arg === "--allow-shrink" || arg === "--allow-catalog-shrink") allowShrink = true
    else if (arg.startsWith("--max-products=")) maxProducts = Number(arg.slice("--max-products=".length))
    else if (arg.startsWith("--concurrency=")) concurrency = Number(arg.slice("--concurrency=".length))
    else if (arg.startsWith("--throttle-ms=")) throttleMs = Number(arg.slice("--throttle-ms=".length))
  }

  return { commit, allowShrink, maxProducts, concurrency, throttleMs }
}

export default async function ingestDarbyCatalog({
  container,
}: {
  container: MedusaContainer
}) {
  const medmkp = container.resolve<MedMKPModuleService>(MEDMKP_MODULE)
  const { commit, allowShrink, maxProducts, concurrency, throttleMs } = parseArgs()

  console.log(`[darby] ${commit ? "COMMIT" : "DRY RUN"} — sitemap-driven priced catalog (streamed)`)

  // Stage 1: discover product URLs from the sitemap.
  const itemUrls = await discoverDarbyItemUrls({
    fetchText,
    log: (msg) => console.log(msg),
    maxUrls: maxProducts,
  })
  if (!itemUrls.length) {
    console.error("[darby] No product URLs discovered — aborting (check sitemap/UA).")
    return
  }
  console.log(`[darby] Discovered ${itemUrls.length} product URLs; fetching pages…`)

  if (commit) {
    assertDestructiveDbOperationAllowed("darby:ingest --commit (writes supplier catalog rows)")

    const existingSupplier = await medmkp.listSuppliers({ id: [SUPPLIER_ID] })
    if (!existingSupplier.length) {
      await medmkp.createSuppliers([
        {
          id: SUPPLIER_ID,
          name: "Darby Dental",
          slug: "darby-dental",
          website_url: SOURCE_URL,
          support_email: "",
          onboarding_status: "in_review" as const,
          ein_last_four: "",
          certification_summary:
            "Public Magento catalog with public pricing parsed from the Darby sitemap.",
          default_lead_time_days: 0,
          ach_enabled: false,
          catalog_source_urls: JSON.stringify([DARBY_SITEMAP_INDEX]),
          catalog_source_notes:
            "Public product pages parsed from the embedded Magento/GA4 model (name, brand, MPN, pack, public price, stock).",
        },
      ])
      console.log(`[darby] Created supplier ${SUPPLIER_ID}`)
    }
  }

  // The source row is upserted by the reconcile session; build it once.
  const { source } = buildSupplierCatalogIngestion(
    {
      supplier_id: SUPPLIER_ID,
      source_type: "website",
      source_catalog: SOURCE_CATALOG,
      source_url: SOURCE_URL,
      auth_required: false,
      refresh_frequency: "weekly",
      rows: [],
    },
    []
  )

  const session = commit
    ? await beginSupplierCatalogReconcile(
        medmkp as unknown as ReconcileService,
        { supplier_id: SUPPLIER_ID, source_catalog: SOURCE_CATALOG, source },
        { allowCatalogShrink: allowShrink, chunkSize: DB_CHUNK_SIZE, log: console.log }
      )
    : null

  // Stage 2: fetch + parse + write in streamed batches. Only one batch's pages
  // and artifacts are in memory at a time; cross-batch SKU dedupe uses a set of
  // strings, and the reconcile session tracks seen ids for the final stale
  // soft-delete.
  let fetched = 0
  let failures = 0
  let written = 0
  let priced = 0
  const seenSku = new Set<string>()

  for (const urlBatch of chunk(itemUrls, FETCH_BATCH_SIZE)) {
    const parsed = await mapPool(urlBatch, concurrency, async (url) => {
      const html = await fetchText(url)
      if (throttleMs) await sleep(throttleMs)
      const done = ++fetched
      if (done % 500 === 0 || done === itemUrls.length) {
        console.log(`[darby]   fetched ${done}/${itemUrls.length} (failures ${failures}, written ${written})`)
      }
      if (!html) {
        failures++
        return null
      }
      const row = darbyProductExtract(candidateFor(url), html)
      if (!row?.sku) failures++
      return row
    })

    const rows: SupplierCatalogRow[] = []
    for (const row of parsed) {
      if (!row?.sku || seenSku.has(row.sku)) continue
      seenSku.add(row.sku)
      const price_cents = cents(row.price)
      if (typeof price_cents === "number") priced++
      rows.push({ ...row, price_cents })
    }
    if (!rows.length) continue

    if (session) {
      const ingestion = buildSupplierCatalogIngestion(
        {
          supplier_id: SUPPLIER_ID,
          source_type: "website",
          source_catalog: SOURCE_CATALOG,
          source_url: SOURCE_URL,
          auth_required: false,
          refresh_frequency: "weekly",
          rows,
        },
        []
      )
      await session.upsertBatch({
        supplierProducts: ingestion.supplierProducts as never,
        canonicalProductMatches: ingestion.canonicalProductMatches as never,
        priceSnapshots: ingestion.priceSnapshots as never,
      })
    }
    written += rows.length
  }

  console.log(
    `[darby] Parsed/${commit ? "wrote" : "would write"} ${written} unique products (${priced} priced) from ${itemUrls.length} URLs (${failures} fetch/parse failures)`
  )

  if (session) {
    const result = await session.finalize()
    console.log(
      `[darby] COMMIT complete — products(+${result.supplier_products.created}/~${result.supplier_products.updated}/restore ${result.supplier_products.restored}/-${result.supplier_products.soft_deleted}) ` +
        `matches(+${result.canonical_product_matches.created}/restore ${result.canonical_product_matches.restored}/-${result.canonical_product_matches.soft_deleted}) ` +
        `snapshots(+${result.price_snapshots.created}/~${result.price_snapshots.updated}).`
    )
  }
}
