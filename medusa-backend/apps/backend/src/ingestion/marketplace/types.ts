// Search-driven marketplace ingestion (Alibaba, Amazon, ...).
//
// Unlike the crawl-based supplier pipeline (sitemap -> index -> extract), a
// marketplace has no catalog we can enumerate. Instead we take the canonical
// products MedMKP already knows about and ask the marketplace, by name, "do you
// carry this?". Each provider only has to know two things: how to turn a query
// into a search URL, and how to turn a fetched search page into normalized
// results. Fetching is a separate, injectable concern (see fetch.ts) because
// marketplaces aggressively block bots, so production runs route through a
// scraping proxy / data API rather than a naive fetch.

export type MarketplaceSearchResult = {
  /** Listing title as shown on the marketplace. */
  title: string
  /** Canonical product detail URL (absolute). */
  product_url: string
  /** Primary listing image (absolute), or "" when none was found. */
  image_url: string
  /** Lowest detected price in cents, when a price could be parsed. */
  price_cents?: number
  /** Raw price string as displayed ("US $1.20-$3.40"), for debugging/display. */
  price_text?: string
  /** ISO-4217 currency when detectable (defaults to "USD"). */
  currency?: string
  /** Brand/supplier/store name when the card exposes one. */
  brand?: string
  /** Anything provider-specific worth keeping for later re-parsing. */
  raw?: Record<string, unknown>
}

export type MarketplaceFetchResult = {
  /** The URL we were asked to fetch. */
  url: string
  /** The URL we ended up at after redirects. */
  final_url: string
  status: number
  ok: boolean
  body: string
  /** True when the response looks like an anti-bot/captcha interstitial. */
  blocked: boolean
  error?: string
}

export type MarketplaceFetchOptions = {
  timeoutMs?: number
  headers?: Record<string, string>
}

/**
 * Transport seam. The default implementation is a plain Node fetch with
 * browser-like headers, optionally routed through a scraping proxy/data API via
 * env (see createMarketplaceFetcher). Tests inject a deterministic fetcher.
 */
export type MarketplaceFetcher = (
  url: string,
  options?: MarketplaceFetchOptions
) => Promise<MarketplaceFetchResult>

export type MarketplaceProvider = {
  /** Stable id, also used as the supplier slug and source-catalog prefix. */
  id: string
  /** Supplier row to provision/attach this marketplace's products to. */
  supplier: {
    name: string
    slug: string
    website_url: string
  }
  /** Build the search-results URL for a free-text query. */
  buildSearchUrl: (query: string) => string
  /** Parse a fetched search-results page into normalized results. */
  parseResults: (
    html: string,
    context: { query: string; baseUrl: string }
  ) => MarketplaceSearchResult[]
}
