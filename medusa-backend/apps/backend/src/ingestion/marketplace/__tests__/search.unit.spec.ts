import { alibabaProvider } from "../providers/alibaba"
import { amazonProvider } from "../providers/amazon"
import { resultToRow, searchCanonicalOnMarketplace } from "../search"
import type { MarketplaceFetcher } from "../types"

const ALIBABA_HTML = `
  <h2 class="search-card-e-title">
    <a href="https://www.alibaba.com/product-detail/Dental-Composite-Resin_1600999.html?spm=a">Dental Composite Resin Kit</a>
  </h2>
  <a class="slider" href="https://www.alibaba.com/product-detail/Dental-Composite-Resin_1600999.html?spm=a">
    <img class="search-card-e-slider__img" src="//s.alicdn.com/kf/H99.jpg">
  </a>
  <div class="search-card-e-price-main">US $2.00 - $5.00</div>
`

function stubFetcher(body: string, overrides = {}): MarketplaceFetcher {
  return async (url) => ({
    url,
    final_url: url,
    status: 200,
    ok: true,
    body,
    blocked: false,
    ...overrides,
  })
}

const canonical = {
  id: "mcp_composite_resin",
  name: "Composite Resin",
  category: "Restorative",
  unit_of_measure: "syringe",
}

describe("searchCanonicalOnMarketplace", () => {
  it("maps marketplace results into canonical-tagged rows", async () => {
    const result = await searchCanonicalOnMarketplace(
      alibabaProvider,
      stubFetcher(ALIBABA_HTML),
      canonical,
      { maxResults: 3 }
    )

    expect(result.query).toBe("Composite Resin")
    expect(result.rows).toHaveLength(1)
    const row = result.rows[0]
    expect(row.sku).toBe("alibaba:1600999")
    expect(row.canonical_product_id).toBe("mcp_composite_resin")
    expect(row.image_url).toBe("https://s.alicdn.com/kf/H99.jpg")
    expect(row.price_cents).toBe(200)
    expect(row.category).toBe("Restorative")
    expect(row.canonical_match_status).toBe("exact") // both canonical tokens present
  })

  it("returns no rows when the fetch is anti-bot blocked", async () => {
    const result = await searchCanonicalOnMarketplace(
      alibabaProvider,
      stubFetcher("<title>Captcha Interception</title>", { blocked: true }),
      canonical
    )

    expect(result.blocked).toBe(true)
    expect(result.rows).toHaveLength(0)
  })

  it("resolves relative hrefs against the marketplace URL, not the scraper proxy", async () => {
    // Through a scraper proxy, final_url is the proxy; relative Amazon hrefs must
    // still resolve to amazon.com, not the proxy host.
    const proxyFetcher: MarketplaceFetcher = async (url) => ({
      url,
      final_url: "https://api.scraperapi.com/?api_key=x&url=" + encodeURIComponent(url),
      status: 200,
      ok: true,
      blocked: false,
      body: `
        <a href="/Bur-Block/dp/B0D7QTDD94/ref=sr_1_1"><img class="s-image" src="https://m.media-amazon.com/images/I/51X2.jpg"></a>
        <h2><a href="/Bur-Block/dp/B0D7QTDD94/ref=sr_1_1"><span>Dental Bur Block 8 Hole</span></a></h2>
        <span class="a-price"><span class="a-offscreen">$19.36</span></span>
      `,
    })

    const result = await searchCanonicalOnMarketplace(amazonProvider, proxyFetcher, canonical)
    expect(result.rows[0].product_url).toBe(
      "https://www.amazon.com/Bur-Block/dp/B0D7QTDD94/ref=sr_1_1"
    )
    expect(result.rows[0].sku).toBe("amazon:B0D7QTDD94")
    expect(result.rows[0].price_cents).toBe(1936)
  })

  it("applies a query prefix", async () => {
    const result = await searchCanonicalOnMarketplace(
      alibabaProvider,
      stubFetcher(""),
      canonical,
      { queryPrefix: "dental " }
    )
    expect(result.query).toBe("dental Composite Resin")
  })
})

describe("resultToRow", () => {
  it("grades a weak title overlap as needs_review but still attaches the canonical", () => {
    const row = resultToRow(alibabaProvider, canonical, {
      title: "Generic Plastic Tray",
      product_url: "https://www.alibaba.com/product-detail/tray_222222.html",
      image_url: "",
    })
    expect(row.canonical_match_status).toBe("needs_review")
    expect(row.canonical_product_id).toBe("mcp_composite_resin")
  })
})
