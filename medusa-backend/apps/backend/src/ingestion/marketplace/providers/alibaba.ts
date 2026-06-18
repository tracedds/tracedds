import {
  dedupeResults,
  parseJsonLdResults,
  parseProximityCards,
} from "../parse"
import type { MarketplaceProvider } from "../types"

const SEARCH_BASE = "https://www.alibaba.com/trade/search"

// Alibaba listing detail URLs look like
//   https://www.alibaba.com/product-detail/<slug>_<id>.html
export const ALIBABA_DETAIL_PATTERN = /\/product-detail\//i

export const alibabaProvider: MarketplaceProvider = {
  id: "alibaba",
  supplier: {
    name: "Alibaba",
    slug: "alibaba",
    website_url: "https://www.alibaba.com",
  },
  buildSearchUrl(query: string): string {
    const params = new URLSearchParams({ SearchText: query, tab: "all" })
    return `${SEARCH_BASE}?${params.toString()}`
  },
  parseResults(html, context) {
    return dedupeResults([
      parseJsonLdResults(html, context.baseUrl),
      parseProximityCards(html, context.baseUrl, {
        detailUrlPattern: ALIBABA_DETAIL_PATTERN,
      }),
    ])
  },
}
