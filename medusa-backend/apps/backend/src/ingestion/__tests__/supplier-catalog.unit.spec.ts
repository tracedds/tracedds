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

  const baseInput = (rows: { sku?: string; name?: string; price_cents?: number }[]) => ({
    supplier_id: "msup_pearson",
    source_type: "website" as const,
    source_catalog: "pearson-dental-website-public",
    rows,
    captured_at: "2026-06-17T00:00:00.000Z",
  })

  it("derives stable supplier product ids independent of row order (idempotent re-ingestion)", () => {
    const a = buildSupplierCatalogIngestion(
      baseInput([
        { sku: "F87-0022", name: "Glove S", price_cents: 299 },
        { sku: "F87-0028", name: "Glove XL", price_cents: 299 },
      ]),
      []
    )
    const b = buildSupplierCatalogIngestion(
      baseInput([
        { sku: "F87-0028", name: "Glove XL", price_cents: 299 },
        { sku: "F87-0022", name: "Glove S", price_cents: 299 },
      ]),
      []
    )
    const ids = (ingestion: ReturnType<typeof buildSupplierCatalogIngestion>) =>
      new Set(ingestion.supplierProducts.map((product) => (product as { id: string }).id))
    expect(ids(a)).toEqual(ids(b))
  })

  it("collapses a SKU that repeats within one catalog into a single product", () => {
    const ingestion = buildSupplierCatalogIngestion(
      baseInput([
        { sku: "F87-0022", name: "Glove S (page 1)", price_cents: 299 },
        { sku: "F87-0022", name: "Glove S (page 2)", price_cents: 305 },
      ]),
      []
    )
    expect(ingestion.supplierProducts).toHaveLength(1)
    expect(ingestion.canonicalProductMatches).toHaveLength(1)
  })
})
