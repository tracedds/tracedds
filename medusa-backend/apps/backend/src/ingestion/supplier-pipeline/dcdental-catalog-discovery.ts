import { discoverDcDentalCatalogProductUrls } from "./dcdental-catalog-extraction"
import type { IndexedSupplierUrl, SupplierSeedRow } from "./types"

type DCDentalDiscoveryOptions = {
  timeoutMs?: number
  debug?: boolean
}

// Enumerate every DC Dental product URL once via the flat /api/items offset walk
// (see dcdental-catalog-extraction.ts). This replaced a per-category crawl that
// re-paginated products shared across categories and so needed an unbounded page
// budget; under a finite cap it truncated mid-catalog, and because the commit is
// delete-and-replace, that silently dropped every product it never reached.
export async function discoverDcDentalCatalogUrls(
  suppliers: SupplierSeedRow[],
  options: DCDentalDiscoveryOptions = {}
): Promise<IndexedSupplierUrl[]> {
  const discovered = await discoverDcDentalCatalogProductUrls(suppliers, {
    timeoutMs: options.timeoutMs,
  })
  if (!discovered) {
    return []
  }

  const { supplier, origin, urls } = discovered
  console.log(
    `[dcdental-catalog-discovery] Discovered ${urls.length} product URL(s) via flat catalog walk`
  )

  return urls.map((url): IndexedSupplierUrl => ({
    distributor: supplier.distributor,
    website_url: supplier.website_url,
    origin,
    prices: supplier.prices,
    sitemap_url: `${origin}/api/items`,
    url,
    url_type: "product",
    confidence_score: 95,
    reasons: ["DC Dental flat catalog API product"],
    category: "Dental supplies",
    subcategory: "",
  }))
}
