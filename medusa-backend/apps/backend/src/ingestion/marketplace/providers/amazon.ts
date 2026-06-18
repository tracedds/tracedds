import {
  dedupeResults,
  parseJsonLdResults,
  parseProximityCards,
} from "../parse"
import type { MarketplaceProvider } from "../types"

const SEARCH_BASE = "https://www.amazon.com/s"

// Amazon product URLs are /dp/<ASIN> or /gp/product/<ASIN>, often prefixed with
// a slug. Result cards don't emit JSON-LD, so the proximity parser does the work.
export const AMAZON_DETAIL_PATTERN = /\/(?:dp|gp\/product|gp\/aw\/d)\/[A-Z0-9]{10}/i

export const amazonProvider: MarketplaceProvider = {
  id: "amazon",
  supplier: {
    name: "Amazon",
    slug: "amazon",
    website_url: "https://www.amazon.com",
  },
  buildSearchUrl(query: string): string {
    const params = new URLSearchParams({ k: query })
    return `${SEARCH_BASE}?${params.toString()}`
  },
  parseResults(html, context) {
    return dedupeResults([
      parseJsonLdResults(html, context.baseUrl),
      parseProximityCards(html, context.baseUrl, {
        detailUrlPattern: AMAZON_DETAIL_PATTERN,
      }),
    ])
  },
}
