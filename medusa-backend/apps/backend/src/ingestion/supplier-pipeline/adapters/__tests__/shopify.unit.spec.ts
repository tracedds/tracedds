import { adapterForCandidate } from "../index"
import { shopifyAdapter } from "../shopify"
import type { ProductPageCandidate } from "../../types"

function candidate(partial: Partial<ProductPageCandidate> = {}): ProductPageCandidate {
  return {
    distributor: "DDI Supply",
    website_url: "https://thedentaldistributors.com",
    origin: "https://thedentaldistributors.com",
    prices: "Y",
    sitemap_url: "https://thedentaldistributors.com/sitemap_products_1.xml",
    url: "https://thedentaldistributors.com/products/implacare-ii",
    url_type: "product",
    confidence_score: 90,
    reasons: ["test"],
    category: "Dental supplies",
    subcategory: "",
    ...partial,
  }
}

describe("Shopify adapter matching", () => {
  it("matches DDI Supply product URLs (thedentaldistributors.com and the ddisupply.com alias)", () => {
    expect(shopifyAdapter.matches(candidate())).toBe(true)
    expect(
      shopifyAdapter.matches(
        candidate({ url: "https://ddisupply.com/products/implacare-ii" })
      )
    ).toBe(true)
  })

  it("matches DDI Supply by distributor name regardless of URL", () => {
    expect(
      shopifyAdapter.matches(
        candidate({ distributor: "DDI Supply", url: "https://supplier.test/x" })
      )
    ).toBe(true)
    expect(
      shopifyAdapter.matches(
        candidate({ distributor: "Dental Distributors, Inc.", url: "https://supplier.test/x" })
      )
    ).toBe(true)
  })

  it("routes DDI Supply candidates to the Shopify adapter so the full /products.json catalog path runs", () => {
    expect(adapterForCandidate(candidate()).id).toBe("shopify")
  })

  it("matches TriRock Dental product URLs and by distributor name", () => {
    expect(
      shopifyAdapter.matches(
        candidate({
          distributor: "TriRock Dental",
          url: "https://trirockdental.com/products/hinged-instrument-clips",
        })
      )
    ).toBe(true)
    expect(
      shopifyAdapter.matches(
        candidate({ distributor: "TriRock Dental", url: "https://supplier.test/x" })
      )
    ).toBe(true)
    expect(
      adapterForCandidate(
        candidate({
          distributor: "TriRock Dental",
          url: "https://trirockdental.com/products/hinged-instrument-clips",
        })
      ).id
    ).toBe("shopify")
  })

  it("extracts a normalized row from a captured TriRock Dental product .js payload", () => {
    // Captured live from https://trirockdental.com/products/hinged-instrument-clips.js
    // (2026-07-01), wrapped in the medmkp-shopify-product-json script the pipeline injects.
    const product = {
      id: 10204312142130,
      title: "Hinged Instrument Clips",
      handle: "hinged-instrument-clips",
      vendor: "HuFriedyGroup",
      type: "",
      available: true,
      price: 2740,
      description: "<p>Part Code: IM1000</p>",
      featured_image:
        "//cdn.shopify.com/s/files/1/0676/3125/1762/files/IM100x_Hinged-Instrument-Clips.jpg?v=1780576791",
      variants: [
        {
          id: 51255671980338,
          title: "Default Title",
          sku: "IM1000",
          price: 2740,
          available: true,
          public_title: null,
        },
      ],
    }
    const html =
      "<html></html>\n<script type=\"application/json\" id=\"medmkp-shopify-product-json\">" +
      JSON.stringify(product) +
      "</script>"

    const cand = candidate({
      distributor: "TriRock Dental",
      website_url: "https://trirockdental.com",
      origin: "https://trirockdental.com",
      url: "https://trirockdental.com/products/hinged-instrument-clips",
    })
    const row = shopifyAdapter.extractProduct(cand, html)

    expect(row.sku).toBe("IM1000")
    expect(row.manufacturer_sku).toBe("IM1000")
    expect(row.brand).toBe("HuFriedyGroup")
    expect(row.name).toBe("Hinged Instrument Clips")
    expect(row.price).toBe("27.40")
    expect(row.price_basis).toBe("each")
    expect(row.availability).toBe("in_stock")
    expect(row.product_url).toBe(
      "https://trirockdental.com/products/hinged-instrument-clips"
    )
    expect(row.image_url).toBe(
      "https://cdn.shopify.com/s/files/1/0676/3125/1762/files/IM100x_Hinged-Instrument-Clips.jpg?v=1780576791"
    )
    // TriRock's Shopify variants carry no GTIN/UPC — same limitation as our
    // other Shopify-sourced suppliers, so no lot/expiry barcode hook.
    expect(row.barcode ?? "").toBe("")
  })

  it("still matches the existing Shopify-sourced suppliers", () => {
    expect(
      shopifyAdapter.matches(
        candidate({
          distributor: "American Dental Accessories",
          url: "https://amerdental.com/products/test-product",
        })
      )
    ).toBe(true)
    expect(
      shopifyAdapter.matches(
        candidate({
          distributor: "Carolina Dental Supply",
          url: "https://carolinadental.com/products/test-product",
        })
      )
    ).toBe(true)
  })

  it("does not claim unrelated supplier URLs", () => {
    expect(
      shopifyAdapter.matches(
        candidate({ distributor: "Some Other Supplier", url: "https://example.com/products/x" })
      )
    ).toBe(false)
  })
})
