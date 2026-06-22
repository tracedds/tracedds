/**
 * Darby Dental product-URL discovery.
 *
 * Darby is a Magento storefront whose robots.txt points at
 * /media/sitemap.xml — a sitemap index that fans out to a handful of child
 * sitemaps (~35k product URLs total). Product pages are a single numeric
 * item-number path segment, e.g. /9543404.html or /5259695-01.html; categories
 * live under /categories/. We read the index, fetch each child sitemap, and
 * collect the numeric product URLs.
 *
 * Pure orchestration with an injected fetchText so it is unit-testable against
 * canned sitemap XML; the ingest script supplies the real retrying fetch.
 */

export const DARBY_SITEMAP_INDEX =
  "https://www.darbydental.com/media/sitemap.xml"

const LOC_RE = /<loc>\s*([^<\s]+)\s*<\/loc>/gi
// A Darby product URL is a single numeric segment (optional -NN variant suffix)
// ending in .html, e.g. /9543404.html or /5259695-01.html.
const PRODUCT_PATH_RE = /^\/[0-9]+(?:-[0-9A-Za-z]+)?\.html?$/i

export type DarbyDiscoveryDeps = {
  fetchText: (url: string) => Promise<string>
  log?: (msg: string) => void
  indexUrl?: string
  maxUrls?: number
}

function locsIn(xml: string): string[] {
  const out: string[] = []
  for (const match of xml.matchAll(LOC_RE)) {
    out.push(match[1].replace(/&amp;/g, "&"))
  }
  return out
}

export function isDarbyProductUrl(url: string): boolean {
  try {
    return PRODUCT_PATH_RE.test(new URL(url).pathname)
  } catch {
    return false
  }
}

export async function discoverDarbyItemUrls(
  deps: DarbyDiscoveryDeps
): Promise<string[]> {
  const {
    fetchText,
    log = () => {},
    indexUrl = DARBY_SITEMAP_INDEX,
    maxUrls = Infinity,
  } = deps

  const indexXml = await fetchText(indexUrl)
  if (!indexXml) {
    log("[darby] sitemap index fetch failed")
    return []
  }

  const childSitemaps = locsIn(indexXml).filter((url) =>
    /\.xml(?:\?|$)/i.test(url)
  )
  log(`[darby] sitemap index lists ${childSitemaps.length} child sitemaps`)

  const seen = new Set<string>()
  for (const sitemapUrl of childSitemaps) {
    if (seen.size >= maxUrls) break
    const xml = await fetchText(sitemapUrl)
    if (!xml) {
      log(`[darby] child sitemap fetch failed: ${sitemapUrl}`)
      continue
    }
    let added = 0
    for (const loc of locsIn(xml)) {
      if (!isDarbyProductUrl(loc)) continue
      if (seen.has(loc)) continue
      seen.add(loc)
      added++
      if (seen.size >= maxUrls) break
    }
    log(
      `[darby] ${sitemapUrl.replace("https://www.darbydental.com/", "")}: +${added} product URLs (total ${seen.size})`
    )
  }

  return [...seen]
}
