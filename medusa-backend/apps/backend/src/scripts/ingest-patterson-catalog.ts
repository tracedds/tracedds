import type { MedusaContainer } from "@medusajs/framework"
import { MEDMKP_MODULE } from "../modules/medmkp"
import type MedMKPModuleService from "../modules/medmkp/service"
import { extractPattersonProduct } from "../ingestion/supplier-pipeline/adapters/patterson"
import {
  discoverPattersonItemUrls,
  PATTERSON_SITEMAP_INDEX,
} from "../ingestion/supplier-pipeline/patterson-catalog-discovery"
import {
  buildSupplierCatalogIngestion,
  type SupplierCatalogRow,
} from "../ingestion/supplier-catalog"
import { assertDestructiveDbOperationAllowed } from "../utils/db-safety"

/**
 * Patterson Dental catalog ingestion.
 *
 * Patterson exposes ~120k product pages logged-out via its sitemap, each
 * carrying name, brand, MPN and pack — but no public price (UnitPrice is gated
 * behind login). So this is an identity-only catalog (like Henry Schein): the
 * rows feed substitute matching by MPN / name+brand; no price snapshots.
 *
 * Stage 1 reads the sitemap index → child sitemaps → /Supplies/ItemDetail URLs.
 * Stage 2 fetches each item page (concurrency-limited, browser UA, one retry)
 * and parses the embedded item model. Default run is a DRY RUN; --commit writes
 * (subject to the destructive-DB guard, so a remote/prod DB needs
 * ALLOW_REMOTE_DB_DESTRUCTIVE=true).
 *
 *   yarn patterson:ingest                          # dry run, full catalog
 *   yarn patterson:ingest -- --max-products=200    # quick sample dry run
 *   yarn patterson:ingest -- --commit              # write supplier rows + matches
 */

const SUPPLIER_ID = "msup_pattersondental_com"
const SOURCE_CATALOG = "patterson-website-public"
const DB_CHUNK_SIZE = 500
const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/126.0 Safari/537.36"

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function forChunks<T>(
  rows: T[],
  work: (chunk: T[], index: number, total: number) => Promise<void>
) {
  const total = Math.ceil(rows.length / DB_CHUNK_SIZE)
  for (let offset = 0; offset < rows.length; offset += DB_CHUNK_SIZE) {
    await work(
      rows.slice(offset, offset + DB_CHUNK_SIZE),
      Math.floor(offset / DB_CHUNK_SIZE) + 1,
      total
    )
  }
}

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
        console.warn(`[patterson] fetch failed ${url}: ${(error as Error).message}`)
        return ""
      }
      await sleep(1500)
    }
  }
  return ""
}

// Map an array with a fixed worker pool so we never hold more than `concurrency`
// in-flight requests against Patterson.
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

function parseArgs() {
  const args = process.argv.slice(2)
  let commit = false
  let allowShrink = false
  let allowIncomplete = false
  let maxProducts = Infinity
  let concurrency = 6
  let throttleMs = 0

  for (const arg of args) {
    if (arg === "--commit") commit = true
    else if (arg === "--allow-shrink") allowShrink = true
    else if (arg === "--allow-incomplete") allowIncomplete = true
    else if (arg.startsWith("--max-products=")) maxProducts = Number(arg.slice("--max-products=".length))
    else if (arg.startsWith("--concurrency=")) concurrency = Number(arg.slice("--concurrency=".length))
    else if (arg.startsWith("--throttle-ms=")) throttleMs = Number(arg.slice("--throttle-ms=".length))
  }

  return { commit, allowShrink, allowIncomplete, maxProducts, concurrency, throttleMs }
}

export default async function ingestPattersonCatalog({
  container,
}: {
  container: MedusaContainer
}) {
  const medmkp = container.resolve<MedMKPModuleService>(MEDMKP_MODULE)
  const { commit, allowShrink, allowIncomplete, maxProducts, concurrency, throttleMs } =
    parseArgs()

  console.log(`[patterson] ${commit ? "COMMIT" : "DRY RUN"} — sitemap-driven identity catalog`)

  // Stage 1: discover product URLs from the sitemap.
  const itemUrls = await discoverPattersonItemUrls({
    fetchText,
    log: (msg) => console.log(msg),
    maxUrls: maxProducts,
  })
  if (!itemUrls.length) {
    console.error("[patterson] No item URLs discovered — aborting (check sitemap/UA).")
    return
  }
  console.log(`[patterson] Discovered ${itemUrls.length} product URLs; fetching pages…`)

  // Stage 2: fetch + parse each item page.
  let fetched = 0
  let failures = 0
  const parsed = await mapPool(itemUrls, concurrency, async (url) => {
    const html = await fetchText(url)
    if (throttleMs) await sleep(throttleMs)
    const done = ++fetched
    if (done % 250 === 0 || done === itemUrls.length) {
      console.log(`[patterson]   fetched ${done}/${itemUrls.length} (failures ${failures})`)
    }
    if (!html) {
      failures++
      return null
    }
    const row = extractPattersonProduct(html, url)
    if (!row) failures++
    return row
  })

  const bySku = new Map<string, SupplierCatalogRow>()
  for (const row of parsed) {
    if (!row?.sku) continue
    if (!bySku.has(row.sku)) bySku.set(row.sku, row)
  }
  const rows = [...bySku.values()]
  console.log(
    `[patterson] Parsed ${rows.length} unique products from ${itemUrls.length} URLs (${failures} fetch/parse failures)`
  )

  if (!rows.length) {
    console.error("[patterson] No products parsed — aborting.")
    return
  }

  // A high failure rate means a degraded crawl that must not replace the cache.
  const failureRate = failures / itemUrls.length
  if (commit && failureRate > 0.2 && !allowIncomplete) {
    console.error(
      `[patterson] ABORT: ${(failureRate * 100).toFixed(1)}% of pages failed to fetch/parse ` +
        "(>20%); refusing to replace the cached catalog. Re-run, or pass --allow-incomplete."
    )
    return
  }

  // Match against the live canonical catalog (read-only) to preview substitute quality.
  const canonicalProducts = await medmkp.listCanonicalProducts()
  const ingestion = buildSupplierCatalogIngestion(
    {
      supplier_id: SUPPLIER_ID,
      source_type: "website",
      source_catalog: SOURCE_CATALOG,
      source_url: "https://www.pattersondental.com/Supplies",
      auth_required: false,
      refresh_frequency: "manual",
      rows,
    },
    canonicalProducts.map((p) => ({
      id: p.id,
      name: p.name,
      category: p.category,
      attributes_text: p.attributes_text,
    }))
  )

  const matched = ingestion.canonicalProductMatches.filter(
    (m) => (m as { canonical_product_id: string }).canonical_product_id
  ).length
  console.log(
    `[patterson] ${rows.length} products | ${matched} matched to a canonical product | ${rows.length - matched} unmatched | price snapshots ${ingestion.priceSnapshots.length}`
  )

  const matchById = new Map(canonicalProducts.map((p) => [p.id, p.name] as const))
  const productById = new Map(
    (ingestion.supplierProducts as Array<{ id: string; name: string }>).map((p) => [p.id, p.name])
  )
  const samples = (ingestion.canonicalProductMatches as Array<{
    supplier_product_id: string
    canonical_product_id: string
    match_status: string
    confidence_score: number
  }>)
    .filter((m) => m.canonical_product_id)
    .slice(0, 12)
  console.log("[patterson] Sample matches (Patterson item → canonical, status):")
  for (const m of samples) {
    console.log(
      `   • ${productById.get(m.supplier_product_id)?.slice(0, 48)} → ${matchById.get(m.canonical_product_id)?.slice(0, 48)} [${m.match_status} ${m.confidence_score}]`
    )
  }

  if (!commit) {
    console.log("[patterson] DRY RUN complete — no writes. Re-run with --commit to persist.")
    return
  }

  assertDestructiveDbOperationAllowed("patterson:ingest --commit (writes supplier catalog rows)")

  // Ensure the Patterson supplier row exists.
  const existingSupplier = await medmkp.listSuppliers({ id: [SUPPLIER_ID] })
  if (!existingSupplier.length) {
    await medmkp.createSuppliers([
      {
        id: SUPPLIER_ID,
        name: "Patterson Dental",
        slug: "patterson-dental",
        website_url: "https://www.pattersondental.com",
        support_email: "",
        onboarding_status: "in_review" as const,
        ein_last_four: "",
        certification_summary:
          "Public identity catalog from the Patterson sitemap; prices remain login-gated.",
        default_lead_time_days: 0,
        ach_enabled: false,
        catalog_source_urls: JSON.stringify([PATTERSON_SITEMAP_INDEX]),
        catalog_source_notes:
          "Public /Supplies/ItemDetail pages parsed from the embedded item model (name, brand, MPN, pack); no public price.",
      },
    ])
    console.log(`[patterson] Created supplier ${SUPPLIER_ID}`)
  }

  // Replace any prior Patterson rows for this source, then write the fresh ones.
  const existingProducts = await medmkp.listSupplierProducts({
    supplier_id: SUPPLIER_ID,
    source_catalog: SOURCE_CATALOG,
  })
  // Shrink guard (cf. the DC Dental delete-and-replace incident): refuse a >50%
  // drop unless forced, so a degraded crawl can't wipe a healthy catalog.
  if (
    existingProducts.length > 50 &&
    rows.length < existingProducts.length * 0.5 &&
    !allowShrink
  ) {
    console.error(
      `[patterson] ABORT: crawl found ${rows.length} products but ${existingProducts.length} exist ` +
        `(>50% shrink). Likely a partial crawl — not replacing. Re-run, or pass --allow-shrink to override.`
    )
    return
  }
  if (existingProducts.length) {
    const ids = existingProducts.map((p) => p.id)
    await forChunks(ids, async (chunk) => {
      const existingMatches = await medmkp.listCanonicalProductMatches({
        supplier_product_id: chunk,
      })
      if (existingMatches.length) {
        await forChunks(existingMatches.map((match) => match.id), async (matchChunk) => {
          await medmkp.deleteCanonicalProductMatches(matchChunk)
        })
      }
    })
    await forChunks(ids, async (chunk) => {
      await medmkp.deleteSupplierProducts(chunk)
    })
    console.log(`[patterson] Deleted ${ids.length} prior Patterson products`)
  }

  const existingSources = await medmkp.listSupplierCatalogSources({
    supplier_id: SUPPLIER_ID,
    source_catalog: SOURCE_CATALOG,
  })
  if (existingSources.length) {
    await medmkp.deleteSupplierCatalogSources(existingSources.map((source) => source.id))
  }

  await medmkp.createSupplierCatalogSources(ingestion.source)
  await forChunks(ingestion.supplierProducts, async (chunk, index, total) => {
    console.log(`[patterson] Creating product chunk ${index}/${total} (${chunk.length})`)
    await medmkp.createSupplierProducts(
      chunk as Parameters<typeof medmkp.createSupplierProducts>[0]
    )
  })
  await forChunks(ingestion.canonicalProductMatches, async (chunk, index, total) => {
    console.log(`[patterson] Creating match chunk ${index}/${total} (${chunk.length})`)
    await medmkp.createCanonicalProductMatches(
      chunk as Parameters<typeof medmkp.createCanonicalProductMatches>[0]
    )
  })

  console.log(
    `[patterson] COMMIT complete — wrote ${ingestion.supplierProducts.length} products + ${ingestion.canonicalProductMatches.length} matches.`
  )
}
