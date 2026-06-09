import type {
  DownloadResult,
  SupplierSeedRow,
  SupplierSitemapSummary,
} from "./types"
import { normalizeSiteUrl } from "./suppliers"

function sitemapDirectives(robotsText: string, origin: string) {
  return robotsText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^sitemap:/i.test(line))
    .map((line) => line.replace(/^sitemap:\s*/i, "").trim())
    .map((url) => {
      try {
        return new URL(url, origin).href
      } catch {
        return url
      }
    })
    .filter(Boolean)
    .filter((url, index, urls) => urls.indexOf(url) === index)
}

export function xmlUrls(xml: string) {
  const urls = [...xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)]
    .map((match) => match[1].trim())
    .filter(Boolean)

  return [...new Set(urls)]
}

export async function downloadText(
  url: string,
  timeoutMs = 20_000
): Promise<DownloadResult> {
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "MedMKP supplier catalog ingestion (+https://medmkp.com)",
      },
      signal: AbortSignal.timeout(timeoutMs),
    })
    const body = await response.text()

    return {
      url,
      status: response.status,
      ok: response.ok,
      content_type: response.headers.get("content-type") ?? "",
      bytes: Buffer.byteLength(body),
      body,
    }
  } catch (error) {
    return {
      url,
      status: 0,
      ok: false,
      content_type: "",
      bytes: 0,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

function isSitemapIndex(xml: string) {
  return /<sitemapindex\b/i.test(xml)
}

function debugLog(enabled: boolean | undefined, ...args: unknown[]) {
  if (enabled) {
    console.log("[sitemap-discovery]", ...args)
  }
}

function promiseMap<T, R>(
  items: T[],
  concurrency: number,
  iterator: (item: T, index: number) => Promise<R>
) {
  const results = new Array<R>(items.length)
  let nextIndex = 0

  return Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (nextIndex < items.length) {
        const currentIndex = nextIndex++
        results[currentIndex] = await iterator(items[currentIndex], currentIndex)
      }
    })
  ).then(() => results)
}

export async function discoverSupplierSitemaps(
  suppliers: SupplierSeedRow[],
  options: {
    timeoutMs?: number
    debug?: boolean
    concurrency?: number
    sitemapConcurrency?: number
    maxSitemapsPerSupplier?: number
  } = {}
) {
  const summary = await promiseMap(suppliers, options.concurrency ?? 3, async (supplier) => {
    debugLog(options.debug, `Discovering sitemaps for ${supplier.distributor} (${supplier.website_url})`)
    const site = normalizeSiteUrl(supplier.website_url)
    const robotsUrl = `${site.origin}/robots.txt`
    const robots = await downloadText(robotsUrl, options.timeoutMs)
    const directives = robots.ok && robots.body
      ? sitemapDirectives(robots.body, site.origin)
      : []
    const sitemapUrls = directives.length
      ? directives
      : [`${site.origin}/sitemap.xml`]

    debugLog(
      options.debug,
      `Robots.txt fetched for ${supplier.distributor}: ok=${robots.ok} status=${robots.status} bytes=${robots.bytes} directives=${directives.length}`
    )

    const initialSitemaps = await promiseMap(
      sitemapUrls,
      options.sitemapConcurrency ?? 2,
      async (sitemapUrl) => {
        debugLog(options.debug, `Fetching sitemap ${sitemapUrl}`)
        const sitemap = await downloadText(sitemapUrl, options.timeoutMs)
        debugLog(
          options.debug,
          `Sitemap result for ${sitemapUrl}: ok=${sitemap.ok} status=${sitemap.status} bytes=${sitemap.bytes}`
        )
        return sitemap
      }
    )
    const childSitemapUrls = initialSitemaps
      .filter((sitemap) => sitemap.ok && sitemap.body && isSitemapIndex(sitemap.body))
      .flatMap((sitemap) => xmlUrls(sitemap.body ?? ""))
      .filter((url) => /\.xml($|\?)/i.test(url))
      .filter((url, index, urls) => urls.indexOf(url) === index)
      .slice(0, options.maxSitemapsPerSupplier ?? 5000)

    if (childSitemapUrls.length) {
      debugLog(
        options.debug,
        `Expanding ${childSitemapUrls.length} child sitemap(s) for ${supplier.distributor}`
      )
    }

    const childSitemaps = await promiseMap(
      childSitemapUrls,
      options.sitemapConcurrency ?? 2,
      async (sitemapUrl) => {
        debugLog(options.debug, `Fetching child sitemap ${sitemapUrl}`)
        const sitemap = await downloadText(sitemapUrl, options.timeoutMs)
        debugLog(
          options.debug,
          `Child sitemap result for ${sitemapUrl}: ok=${sitemap.ok} status=${sitemap.status} bytes=${sitemap.bytes}`
        )
        return sitemap
      }
    )
    const sitemaps = [
      ...initialSitemaps.map((sitemap) =>
        sitemap.body && isSitemapIndex(sitemap.body)
          ? { ...sitemap, body: undefined }
          : sitemap
      ),
      ...childSitemaps,
    ]

    return {
      distributor: supplier.distributor,
      website_url: supplier.website_url,
      origin: site.origin,
      prices: supplier.prices,
      robots,
      sitemap_directives: directives,
      used_fallback_sitemap: directives.length === 0,
      sitemaps,
    }
  })

  debugLog(options.debug, `Completed sitemap discovery for ${suppliers.length} supplier(s)`)

  return summary
}
