import { downloadText } from "./sitemap-discovery"
import { classifySupplierUrl } from "./url-index"
import type {
  IndexedSupplierUrl,
  SupplierSourceUrl,
  SupplierSourceUrlSummary,
} from "./types"

function debugLog(enabled: boolean | undefined, ...args: unknown[]) {
  if (enabled) {
    console.log("[source-url-discovery]", ...args)
  }
}

function htmlLinks(html: string, baseUrl: string) {
  const urls = [...html.matchAll(/<a\b[^>]+href=["']([^"']+)["'][^>]*>/gi)]
    .map((match) => match[1].trim())
    .filter((href) => href && !href.startsWith("#"))
    .map((href) => {
      try {
        return new URL(href, baseUrl).href
      } catch {
        return ""
      }
    })
    .filter(Boolean)

  return [...new Set(urls)]
}

function sameOrigin(url: string, origin: string) {
  try {
    return new URL(url).origin === origin
  } catch {
    return false
  }
}

function indexSourceUrl(source: SupplierSourceUrl, url: string): IndexedSupplierUrl {
  return {
    distributor: source.distributor,
    website_url: source.website_url,
    origin: source.origin,
    prices: source.prices,
    sitemap_url: source.source_url,
    url,
    ...classifySupplierUrl(url),
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

export async function discoverSupplierSourceUrls(
  sources: SupplierSourceUrl[],
  options: {
    timeoutMs?: number
    debug?: boolean
    concurrency?: number
    maxLinksPerSource?: number
  } = {}
) {
  const summaries: SupplierSourceUrlSummary[] = []
  const indexedUrls: IndexedSupplierUrl[] = []

  const results = await promiseMap(
    sources,
    options.concurrency ?? 3,
    async (source) => {
      debugLog(options.debug, `Fetching source URL ${source.source_url}`)
      const page = await downloadText(source.source_url, options.timeoutMs)
      const urls = page.ok && page.body
        ? htmlLinks(page.body, source.source_url)
            .filter((url) => sameOrigin(url, source.origin))
            .slice(0, options.maxLinksPerSource ?? 500)
        : []

      return {
        summary: {
          ...source,
          page,
          discovered_urls: urls.length,
        },
        indexedUrls: [
          indexSourceUrl(source, source.source_url),
          ...urls.map((url) => indexSourceUrl(source, url)),
        ],
      }
    }
  )

  for (const result of results) {
    summaries.push(result.summary)
    indexedUrls.push(...result.indexedUrls)
  }

  debugLog(
    options.debug,
    `Completed source URL discovery: ${summaries.length} source page(s), ${indexedUrls.length} indexed URL(s)`
  )

  return {
    summaries,
    indexedUrls,
  }
}
