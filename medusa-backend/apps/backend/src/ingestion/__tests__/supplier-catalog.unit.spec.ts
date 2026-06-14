import { buildSupplierCatalogIngestion } from "../supplier-catalog"

describe("buildSupplierCatalogIngestion", () => {
  it("keeps generated price snapshot IDs unique when long parts are truncated", () => {
    const rows = [
      {
        sku: "21-M407-BUBBLE-GUM-SUPER-LONG-SKU-WITH-A-SHARED-PREFIX-AAAAAAAAAAAA",
        name: "Bubble Gum Prophy Paste",
        price_cents: 1250,
        product_url: "https://supplier.test/products/bubble-gum",
      },
      {
        sku: "21-M407-BUBBLE-GUM-SUPER-LONG-SKU-WITH-A-SHARED-PREFIX-BBBBBBBBBBBB",
        name: "Bubble Gum Prophy Paste",
        price_cents: 1250,
        product_url: "https://supplier.test/products/bubble-gum",
      },
    ]

    const ingestion = buildSupplierCatalogIngestion(
      {
        supplier_id: "msup_amerdental_com",
        source_type: "website",
        source_catalog: "american_dental_accessories_website_public",
        rows,
        captured_at: "2026-06-14T21:05:00.000Z",
      },
      []
    )
    const ids = ingestion.priceSnapshots.map((snapshot) =>
      (snapshot as { id: string }).id
    )

    expect(ids).toHaveLength(2)
    expect(new Set(ids).size).toBe(2)
    expect(ids.every((id) => id.length <= 96)).toBe(true)
  })
})
