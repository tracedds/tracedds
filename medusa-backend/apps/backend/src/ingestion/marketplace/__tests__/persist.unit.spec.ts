import { buildMarketplaceIngestion } from "../persist"
import type { MarketplaceCatalogRow } from "../search"

function row(overrides: Partial<MarketplaceCatalogRow> = {}): MarketplaceCatalogRow {
  return {
    sku: "alibaba:1600999",
    name: "Dental Composite Resin Kit",
    description: "Dental Composite Resin Kit",
    category: "Restorative",
    product_url: "https://www.alibaba.com/product-detail/x_1600999.html",
    image_url: "https://s.alicdn.com/kf/H99.jpg",
    price_cents: 200,
    price_basis: "unknown",
    availability: "unknown",
    canonical_product_id: "mcp_a",
    canonical_match_status: "variant",
    canonical_match_confidence: 60,
    canonical_match_reason: "test",
    ...overrides,
  }
}

describe("buildMarketplaceIngestion", () => {
  it("creates one supplier product, match, and price snapshot per listing", () => {
    const out = buildMarketplaceIngestion({
      supplier_id: "msup_alibaba",
      source_catalog: "alibaba-marketplace-search",
      rows: [row()],
    })

    expect(out.supplierProducts).toHaveLength(1)
    expect(out.canonicalProductMatches).toHaveLength(1)
    expect(out.priceSnapshots).toHaveLength(1)
    expect(out.supplierProducts[0]).toMatchObject({
      supplier_id: "msup_alibaba",
      sku: "alibaba:1600999",
      image_url: "https://s.alicdn.com/kf/H99.jpg",
    })
    expect(out.priceSnapshots[0]).toMatchObject({ price_cents: 200 })
  })

  it("de-duplicates the supplier product when the same listing matches two canonicals, keeping both matches", () => {
    const out = buildMarketplaceIngestion({
      supplier_id: "msup_alibaba",
      source_catalog: "alibaba-marketplace-search",
      rows: [
        row({ canonical_product_id: "mcp_a" }),
        row({ canonical_product_id: "mcp_b" }),
      ],
    })

    expect(out.supplierProducts).toHaveLength(1)
    expect(out.priceSnapshots).toHaveLength(1)
    expect(out.canonicalProductMatches).toHaveLength(2)
    const canonicalIds = out.canonicalProductMatches.map(
      (m) => (m as { canonical_product_id: string }).canonical_product_id
    )
    expect(canonicalIds).toEqual(["mcp_a", "mcp_b"])
  })

  it("skips the price snapshot when no price was found", () => {
    const out = buildMarketplaceIngestion({
      supplier_id: "msup_alibaba",
      source_catalog: "alibaba-marketplace-search",
      rows: [row({ price_cents: undefined })],
    })
    expect(out.priceSnapshots).toHaveLength(0)
  })
})
