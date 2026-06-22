import type { MarketplaceProvider, MarketplaceSearchResult } from "../types"

const SEARCH_BASE = "https://www.net32.com/search"

// Net32 product detail URLs are /ec/<slug>-d-<mpId> — the master-product id is
// in the path. Net32 is Cloudflare-fronted and serves prices from a separate
// POST /rest/neo/search/getBestPrice, so this provider can NOT parse raw search
// HTML. Its companion fetcher (createNet32SidecarFetcher) drives a real browser
// on the NUC and returns a JSON body of { products, bestPriceMap }, which we
// parse here. See net32-fetch.ts and the net32-harvester sidecar.
export const NET32_DETAIL_PATTERN = /\/ec\/[^"'?#]*-d-(\d+)/i

type Net32Product = { mpId: number; url: string; name?: string; image?: string }

type Net32BestPrice = {
  unitPrice?: number
  retailPrice?: number
  /** The underlying Net32 vendor behind the winning offer (e.g. "Frontier Dental Supply"). */
  name?: string
  inStockSw?: boolean
  inventory?: number
  averageShipTime?: number
  shippingCost?: number
  mpName?: string
  brandName?: string
  vendorProductId?: number
}

type Net32Body = {
  products?: Net32Product[]
  bestPriceMap?: Record<string, Net32BestPrice>
}

function toCents(value: number | undefined): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return undefined
  }
  return Math.round(value * 100)
}

export const net32Provider: MarketplaceProvider = {
  id: "net32",
  supplier: {
    name: "Net32",
    slug: "net32",
    website_url: "https://www.net32.com",
  },
  buildSearchUrl(query: string): string {
    // Net32 filters on the `query` param (a bare `q` returns the full catalog).
    const params = new URLSearchParams({ query })
    return `${SEARCH_BASE}?${params.toString()}`
  },
  // `html` is the JSON body produced by the Net32 sidecar fetcher, not HTML.
  parseResults(html): MarketplaceSearchResult[] {
    let body: Net32Body
    try {
      body = JSON.parse(html)
    } catch {
      return []
    }

    const bestPriceMap = body.bestPriceMap ?? {}
    const results: MarketplaceSearchResult[] = []

    for (const product of body.products ?? []) {
      const bp = bestPriceMap[String(product.mpId)]
      // Title comes from getBestPrice's mpName (the price-time name), falling back
      // to the search ItemList name. Without a title or URL there's nothing to
      // match against a canonical product, so skip.
      const title = (bp?.mpName || product.name || "").trim()
      if (!title || !product.url) {
        continue
      }

      results.push({
        title,
        product_url: product.url,
        image_url: product.image ?? "",
        price_cents: toCents(bp?.unitPrice),
        price_text:
          typeof bp?.unitPrice === "number" ? `$${bp.unitPrice.toFixed(2)}` : undefined,
        currency: "USD",
        brand: bp?.brandName?.trim() || undefined,
        raw: {
          source: "net32-getBestPrice",
          net32_mp_id: product.mpId,
          // The actual seller behind Net32's winning offer — kept for honest
          // attribution, never presented as MedMKP's own multi-vendor comparison.
          net32_vendor: bp?.name,
          net32_vendor_product_id: bp?.vendorProductId,
          retail_price_cents: toCents(bp?.retailPrice),
          in_stock: bp?.inStockSw,
          inventory: bp?.inventory,
          average_ship_time_days: bp?.averageShipTime,
          shipping_cost_cents: toCents(bp?.shippingCost),
        },
      })
    }

    return results
  },
}
