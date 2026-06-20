/**
 * Patterson Dental product-URL discovery.
 *
 * Unlike Henry Schein, Patterson publishes a complete sitemap. The robots.txt
 * points at /sitemapindex.xml, which fans out to sitemap1..N.xml; the product
 * pages (/Supplies/ItemDetail/{item number}) live in the larger child sitemaps
 * (~120k URLs total). We read the index, fetch each child sitemap, and collect
 * the US ItemDetail URLs, dropping the /en-CA and /fr-CA locale duplicates so a
 * product is ingested once.
 *
 * Pure orchestration with an injected fetchText so it is unit-testable against
 * canned sitemap XML; the ingest script supplies the real retrying fetch.
 */

export const PATTERSON_SITEMAP_INDEX =
  "https://www.pattersondental.com/sitemapindex.xml"

const LOC_RE = /<loc>\s*([^<\s]+)\s*<\/loc>/gi
const ITEM_DETAIL_RE = /\/Supplies\/ItemDetail\/\d+(?:\?|$|#)/i
const LOCALE_RE = /\/(?:en-CA|fr-CA)\//i

export type PattersonDiscoveryDeps = {
  fetchText: (url: string) => Promise<string>
  log?: (msg: string) => void
  indexUrl?: string
  maxUrls?: number
}

function locsIn(xml: string): string[] {
  const out: string[] = []
  for (const match of xml.matchAll(LOC_RE)) {
    // Sitemap <loc> values are XML-escaped (&amp;); normalize the one entity
    // that appears in Patterson URLs so the link is usable as-is.
    out.push(match[1].replace(/&amp;/g, "&"))
  }
  return out
}

function isProductUrl(url: string): boolean {
  return ITEM_DETAIL_RE.test(url) && !LOCALE_RE.test(url)
}

function normalizeItemUrl(url: string): string {
  // Item pages are keyed by the public item number; strip any query/fragment so
  // the same item from different sitemap rows dedupes cleanly.
  return url.split(/[?#]/)[0]
}

export async function discoverPattersonItemUrls(
  deps: PattersonDiscoveryDeps
): Promise<string[]> {
  const {
    fetchText,
    log = () => {},
    indexUrl = PATTERSON_SITEMAP_INDEX,
    maxUrls = Infinity,
  } = deps

  const indexXml = await fetchText(indexUrl)
  if (!indexXml) {
    log("[patterson] sitemap index fetch failed")
    return []
  }

  const childSitemaps = locsIn(indexXml).filter((url) => /\.xml(?:\?|$)/i.test(url))
  log(`[patterson] sitemap index lists ${childSitemaps.length} child sitemaps`)

  const seen = new Set<string>()
  for (const sitemapUrl of childSitemaps) {
    if (seen.size >= maxUrls) break
    const xml = await fetchText(sitemapUrl)
    if (!xml) {
      log(`[patterson] child sitemap fetch failed: ${sitemapUrl}`)
      continue
    }
    let added = 0
    for (const loc of locsIn(xml)) {
      if (!isProductUrl(loc)) continue
      const url = normalizeItemUrl(loc)
      if (seen.has(url)) continue
      seen.add(url)
      added++
      if (seen.size >= maxUrls) break
    }
    log(
      `[patterson] ${sitemapUrl.replace("https://www.pattersondental.com/", "")}: +${added} item URLs (total ${seen.size})`
    )
  }

  return [...seen]
}
