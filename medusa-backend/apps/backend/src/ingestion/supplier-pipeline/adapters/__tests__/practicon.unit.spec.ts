import { practiconAdapter } from "../practicon"
import type { ProductPageCandidate } from "../../types"

function candidate(partial: Partial<ProductPageCandidate> = {}): ProductPageCandidate {
  return {
    distributor: "Practicon",
    website_url: "https://www.practicon.com",
    origin: "https://www.practicon.com",
    prices: "Y",
    sitemap_url: "https://www.practicon.com/xmlsitemap.php?type=products&page=1",
    url: "https://www.practicon.com/aeropro-disposable-barrier-sleeves-500-box/p/70629191",
    url_type: "product",
    confidence_score: 95,
    reasons: ["test"],
    ...partial,
  }
}

function page(attributes: Record<string, unknown>) {
  return `
    <html>
      <head>
        <meta property="og:image" content="https://cdn11.bigcommerce.com/products/70629191.jpg" />
        <meta property="og:description" content="Barrier sleeves, 500 per box." />
        <meta property="og:availability" content="instock" />
      </head>
      <body>
        <nav id="nav-breadcrumbs" aria-label="Breadcrumb">
          <ol class="breadcrumbs">
            <li><a itemprop="item" href="/"><span itemprop="name">Home</span></a></li>
            <li><a itemprop="item" href="/shop-by-category/"><span itemprop="name">Shop by Category</span></a></li>
            <li><a itemprop="item" href="/sip/"><span itemprop="name">Sterilization &amp; Infection Prevention</span></a></li>
            <li><a itemprop="item" href="/bp/"><span itemprop="name">Barrier Protection</span></a></li>
            <li><a itemprop="item" href="/hsc/"><span itemprop="name">Handpieces &amp; Small Control</span></a></li>
            <li><a itemprop="item" aria-current="page"><span itemprop="name">AeroPro Disposable Barrier Sleeves 500/Box</span></a></li>
          </ol>
        </nav>
        <h1 class="productView-title" itemprop="name">AeroPro Disposable Barrier Sleeves 500/Box</h1>
        <h2 class="productView-brand" itemprop="brand" itemscope itemtype="https://schema.org/Brand">
          <a href="/premier-dental-products/" itemprop="url"><span itemprop="name">Premier Dental Products</span></a>
        </h2>
        <script type="text/javascript">
          var BCData = {"product_attributes":${JSON.stringify(attributes)},"csrf_token":"abc"};
        </script>
      </body>
    </html>
  `
}

describe("practiconAdapter", () => {
  it("matches Practicon product URLs", () => {
    expect(practiconAdapter.matches(candidate())).toBe(true)
    expect(
      practiconAdapter.matches(candidate({ url: "https://example.com/p/1", distributor: "Other" }))
    ).toBe(false)
  })

  it("extracts SKU, MPN, brand, price and taxonomy from the BigCommerce data layer", () => {
    const row = practiconAdapter.extractProduct(
      candidate(),
      page({
        sku: "70629191",
        upc: null,
        mpn: "5500530",
        gtin: null,
        price: {
          without_tax: { value: 54.99 },
          sale_price_without_tax: { value: 48.99 },
        },
      })
    )

    expect(row.sku).toBe("70629191")
    expect(row.manufacturer_sku).toBe("5500530")
    expect(row.brand).toBe("Premier Dental Products")
    expect(row.name).toBe("AeroPro Disposable Barrier Sleeves 500/Box")
    expect(row.price).toBe("48.99")
    expect(row.price_basis).toBe("each")
    expect(row.availability).toBe("in_stock")
    expect(row.category).toBe("Sterilization & Infection Prevention")
    expect(row.subcategory).toBe("Barrier Protection")
    expect(row.product_line).toBe("Handpieces & Small Control")
    expect(row.pack_size).toBe("500/Box")
    expect(row.image_url).toBe("https://cdn11.bigcommerce.com/products/70629191.jpg")
    expect(row.barcode).toBe("")
  })

  it("captures the GTIN/UPC barcode when present", () => {
    const withGtin = practiconAdapter.extractProduct(
      candidate(),
      page({ sku: "1", mpn: "M1", gtin: "00812345678901", upc: null })
    )
    expect(withGtin.barcode).toBe("00812345678901")

    const withUpc = practiconAdapter.extractProduct(
      candidate(),
      page({ sku: "2", mpn: "M2", gtin: null, upc: "812345678901" })
    )
    expect(withUpc.barcode).toBe("812345678901")
  })

  it("falls back to list price when there is no sale price", () => {
    const row = practiconAdapter.extractProduct(
      candidate(),
      page({ sku: "3", mpn: "M3", price: { without_tax: { value: 12.5 } } })
    )
    expect(row.price).toBe("12.50")
  })
})
