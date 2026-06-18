import { downloadText, xmlUrls } from "./sitemap-discovery"
import { normalizeSiteUrl } from "./suppliers"
import type { IndexedSupplierUrl, SupplierSeedRow } from "./types"

/**
 * Practicon (practicon.com) is a BigCommerce store whose sitemap is served from
 * `/xmlsitemap.php` rather than `/sitemap.xml`, and robots.txt has no Sitemap
 * directive. The standard discovery only follows `.xml` children, so it never
 * reaches the `xmlsitemap.php?type=products` feed. This module fetches that
 * index, expands the product feed(s) and emits SKU-level product candidates.
 */
type PracticonDiscoveryOptions = {
  timeoutMs?: number
  debug?: boolean
  concurrency?: number
  maxPages?: number
}

function debugLog(enabled: boolean | undefined, ...args: unknown[]) {
  if (enabled) {
    console.log("[practicon-catalog-discovery]", ...args)
  }
}

function infoLog(...args: unknown[]) {
  console.log("[practicon-catalog-discovery]", ...args)
}

function decodeEntities(value: string) {
  return value.replace(/&amp;/gi, "&")
}

function practiconSupplier(supplier: SupplierSeedRow) {
  try {
    const site = normalizeSiteUrl(supplier.website_url)
    return (
      /practicon\.com$/i.test(new URL(site.origin).hostname) ||
      /practicon/i.test(supplier.distributor)
    )
  } catch {
    return /practicon/i.test(supplier.distributor)
  }
}

async function promiseMap<T, R>(
  items: T[],
  concurrency: number,
  iterator: (item: T, index: number) => Promise<R>
) {
  const results = new Array<R>(items.length)
  let nextIndex = 0

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (nextIndex < items.length) {
        const currentIndex = nextIndex++
        results[currentIndex] = await iterator(items[currentIndex], currentIndex)
      }
    })
  )

  return results
}

export async function discoverPracticonCatalogUrls(
  suppliers: SupplierSeedRow[],
  options: PracticonDiscoveryOptions = {}
) {
  const supplier = suppliers.find(practiconSupplier)
  if (!supplier) {
    return [] as IndexedSupplierUrl[]
  }

  const site = normalizeSiteUrl(supplier.website_url)
  const origin = site.origin
  const concurrency = options.concurrency ?? 3
  const maxPages = options.maxPages ?? 50

  infoLog(`Starting Practicon catalog discovery (${origin})`)

  const index = await downloadText(`${origin}/xmlsitemap.php`, options.timeoutMs)
  if (!index.ok || !index.body) {
    infoLog(
      `Practicon sitemap index unavailable: status=${index.status} error=${index.error ?? "none"}`
    )
    return [] as IndexedSupplierUrl[]
  }

  const productFeeds = xmlUrls(index.body)
    .map(decodeEntities)
    .filter((url) => /xmlsitemap\.php\?[^"']*type=products/i.test(url))
    .filter((url, position, urls) => urls.indexOf(url) === position)
    .slice(0, maxPages)

  debugLog(options.debug, `Product feed(s): ${productFeeds.join(", ") || "none"}`)

  const products = new Map<string, IndexedSupplierUrl>()
  const feeds = await promiseMap(productFeeds, concurrency, async (feedUrl) => {
    debugLog(options.debug, `Fetching product feed ${feedUrl}`)
    return { feedUrl, feed: await downloadText(feedUrl, options.timeoutMs) }
  })

  for (const { feedUrl, feed } of feeds) {
    if (!feed.ok || !feed.body) {
      continue
    }

    for (const url of xmlUrls(feed.body).map(decodeEntities)) {
      if (products.has(url)) {
        continue
      }

      products.set(url, {
        distributor: supplier.distributor,
        website_url: supplier.website_url,
        origin,
        prices: supplier.prices,
        sitemap_url: feedUrl,
        url,
        url_type: "product",
        confidence_score: 95,
        reasons: ["Practicon sitemap product feed"],
      })
    }
  }

  infoLog(
    `Practicon catalog discovery complete: ${productFeeds.length} feed(s), ${products.size} product URL(s)`
  )

  return [...products.values()]
}
