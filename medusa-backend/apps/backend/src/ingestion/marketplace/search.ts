import type { SupplierCatalogRow } from "../supplier-catalog"
import { marketplaceProductId, titleOverlapConfidence } from "./parse"
import type {
  MarketplaceFetcher,
  MarketplaceProvider,
  MarketplaceSearchResult,
} from "./types"

type MatchStatus = "exact" | "variant" | "substitute" | "needs_review" | "unmatched"

export type CanonicalProductInput = {
  id: string
  name: string
  category?: string
  unit_of_measure?: string
}

/**
 * A supplier-catalog row carrying the canonical product it was sourced for. The
 * match is known by construction (we searched the marketplace by this canonical
 * product's name), so we attach it directly instead of re-running fuzzy scoring.
 */
export type MarketplaceCatalogRow = SupplierCatalogRow & {
  canonical_product_id: string
  canonical_match_status: MatchStatus
  canonical_match_confidence: number
  canonical_match_reason: string
}

export type SearchCanonicalOptions = {
  /** Max results to keep per canonical product. */
  maxResults?: number
  /** Prepended to the canonical name to bias the search (e.g. "dental "). */
  queryPrefix?: string
  timeoutMs?: number
}

export type SearchCanonicalResult = {
  canonical: CanonicalProductInput
  query: string
  url: string
  status: number
  blocked: boolean
  error?: string
  results: MarketplaceSearchResult[]
  rows: MarketplaceCatalogRow[]
}

// A marketplace listing surfaced by searching the canonical product's name is a
// plausible alternative source, not a verified identical SKU. Title token
// overlap grades how confident that mapping is.
function matchStatusForConfidence(confidence: number): MatchStatus {
  if (confidence >= 80) return "exact"
  if (confidence >= 55) return "variant"
  if (confidence >= 30) return "substitute"
  return "needs_review"
}

export function resultToRow(
  provider: MarketplaceProvider,
  canonical: CanonicalProductInput,
  result: MarketplaceSearchResult
): MarketplaceCatalogRow {
  const sku = `${provider.id}:${marketplaceProductId(result.product_url)}`
  const confidence = titleOverlapConfidence(result.title, canonical.name)

  return {
    sku,
    name: result.title,
    description: result.title,
    brand: result.brand,
    category: canonical.category || "Dental supplies",
    product_url: result.product_url,
    image_url: result.image_url,
    unit_of_measure: canonical.unit_of_measure,
    price_cents: result.price_cents,
    price_basis: "unknown",
    availability: "unknown",
    raw: {
      provider: provider.id,
      currency: result.currency,
      price_text: result.price_text,
      sourced_for_canonical_product_id: canonical.id,
      ...result.raw,
    },
    canonical_product_id: canonical.id,
    canonical_match_status: matchStatusForConfidence(confidence),
    canonical_match_confidence: confidence,
    canonical_match_reason: `Sourced via ${provider.id} search for canonical product name; ${confidence}% title overlap`,
  }
}

export function buildQuery(
  canonical: CanonicalProductInput,
  options: SearchCanonicalOptions = {}
): string {
  return `${options.queryPrefix ?? ""}${canonical.name}`.trim()
}

/**
 * Search a marketplace for one canonical product and return normalized rows.
 * Fetching is delegated to the injected fetcher; an anti-bot/captcha response
 * yields zero rows (and blocked=true) rather than garbage.
 */
export async function searchCanonicalOnMarketplace(
  provider: MarketplaceProvider,
  fetcher: MarketplaceFetcher,
  canonical: CanonicalProductInput,
  options: SearchCanonicalOptions = {}
): Promise<SearchCanonicalResult> {
  const query = buildQuery(canonical, options)
  const url = provider.buildSearchUrl(query)
  const fetched = await fetcher(url, { timeoutMs: options.timeoutMs })

  const base = {
    canonical,
    query,
    url,
    status: fetched.status,
    blocked: fetched.blocked,
    error: fetched.error,
  }

  if (!fetched.ok || fetched.blocked || !fetched.body) {
    return { ...base, results: [], rows: [] }
  }

  // Resolve relative hrefs/images against the marketplace search URL we asked
  // for — NOT fetched.final_url, which is the scraper-proxy URL when routed
  // through MARKETPLACE_SCRAPER_URL (that would yield api.scraperapi.com links).
  const parsed = provider.parseResults(fetched.body, {
    query,
    baseUrl: url,
  })
  const results = (options.maxResults
    ? parsed.slice(0, options.maxResults)
    : parsed
  ).filter((result) => result.product_url && result.title.trim())

  return {
    ...base,
    results,
    rows: results.map((result) => resultToRow(provider, canonical, result)),
  }
}
