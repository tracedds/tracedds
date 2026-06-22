import { createNet32SidecarFetcher } from "../net32-fetch"
import { net32Provider } from "../providers/net32"

describe("net32Provider.buildSearchUrl", () => {
  it("builds the public search URL with the `query` param (a bare `q` is unfiltered)", () => {
    expect(net32Provider.buildSearchUrl("nitrile gloves")).toBe(
      "https://www.net32.com/search?query=nitrile+gloves"
    )
  })
})

describe("net32Provider.parseResults", () => {
  const body = JSON.stringify({
    products: [
      {
        mpId: 126481,
        url: "https://www.net32.com/ec/house-brand-nitrile-d-126481",
        image: "https://www.net32.com/media/house-brand-nitrile.jpg",
      },
      { mpId: 20208, url: "https://www.net32.com/ec/gc-fuji-plus-d-20208" },
      // No bestPriceMap entry and no ItemList name -> dropped.
      { mpId: 999999, url: "https://www.net32.com/ec/orphan-d-999999" },
    ],
    bestPriceMap: {
      "126481": {
        unitPrice: 6.7,
        retailPrice: 21.95,
        name: "Frontier Dental Supply",
        inStockSw: true,
        inventory: 9639,
        averageShipTime: 1,
        shippingCost: 0,
        mpName: "House Brand Powder-Free Nitrile Gloves, Small, 200/Box",
        brandName: "House Brand",
        vendorProductId: 2155967,
      },
      "20208": {
        unitPrice: 187.12,
        retailPrice: 297.99,
        name: "Top Dent",
        inStockSw: true,
        mpName: "GC Fuji Plus Capsule refill 50/pack",
        brandName: "GC",
        vendorProductId: 1990126,
      },
    },
  })

  it("maps each priced product to a result with unit price in cents and vendor in raw", () => {
    const results = net32Provider.parseResults(body, {
      query: "nitrile gloves",
      baseUrl: "https://www.net32.com/search?q=nitrile+gloves",
    })

    expect(results).toHaveLength(2)
    const gloves = results[0]
    expect(gloves.title).toBe(
      "House Brand Powder-Free Nitrile Gloves, Small, 200/Box"
    )
    expect(gloves.product_url).toBe(
      "https://www.net32.com/ec/house-brand-nitrile-d-126481"
    )
    expect(gloves.price_cents).toBe(670)
    expect(gloves.currency).toBe("USD")
    expect(gloves.brand).toBe("House Brand")
    expect(gloves.image_url).toBe(
      "https://www.net32.com/media/house-brand-nitrile.jpg"
    )
    expect(gloves.raw).toMatchObject({
      net32_mp_id: 126481,
      net32_vendor: "Frontier Dental Supply",
      retail_price_cents: 2195,
      in_stock: true,
    })
  })

  it("drops products with no matching bestPriceMap entry", () => {
    const results = net32Provider.parseResults(body, {
      query: "x",
      baseUrl: "https://www.net32.com/search?q=x",
    })
    expect(results.map((r) => r.raw?.net32_mp_id)).toEqual([126481, 20208])
  })

  it("falls back to the ItemList name when getBestPrice omits mpName", () => {
    const partial = JSON.stringify({
      products: [
        { mpId: 5, url: "https://www.net32.com/ec/x-d-5", name: "Fallback Name 100/Box" },
      ],
      bestPriceMap: { "5": { unitPrice: 1.5 } },
    })
    const results = net32Provider.parseResults(partial, {
      query: "x",
      baseUrl: "https://www.net32.com/search?query=x",
    })
    expect(results).toHaveLength(1)
    expect(results[0].title).toBe("Fallback Name 100/Box")
    expect(results[0].price_cents).toBe(150)
  })

  it("returns [] for a non-JSON body", () => {
    expect(
      net32Provider.parseResults("<html>Just a moment...</html>", {
        query: "x",
        baseUrl: "https://www.net32.com/search?q=x",
      })
    ).toEqual([])
  })
})

describe("createNet32SidecarFetcher", () => {
  it("forwards the query to the sidecar and passes the body through", async () => {
    const calls: string[] = []
    const fetchImpl = (async (url: string) => {
      calls.push(url)
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({ blocked: false, products: [], bestPriceMap: {} }),
      }
    }) as unknown as typeof fetch

    const fetcher = createNet32SidecarFetcher({
      baseUrl: "http://127.0.0.1:8791",
      maxResults: 7,
      fetchImpl,
    })
    const result = await fetcher("https://www.net32.com/search?query=nitrile+gloves")

    expect(calls[0]).toBe(
      "http://127.0.0.1:8791/search?q=nitrile%20gloves&max=7"
    )
    expect(result.ok).toBe(true)
    expect(result.blocked).toBe(false)
    expect(JSON.parse(result.body)).toMatchObject({ products: [] })
  })

  it("marks a blocked sidecar response as blocked and not ok", async () => {
    const fetchImpl = (async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ blocked: true, products: [] }),
    })) as unknown as typeof fetch

    const fetcher = createNet32SidecarFetcher({ fetchImpl })
    const result = await fetcher("https://www.net32.com/search?query=x")

    expect(result.blocked).toBe(true)
    expect(result.ok).toBe(false)
  })

  it("returns an error result when the sidecar is unreachable", async () => {
    const fetchImpl = (async () => {
      throw new Error("ECONNREFUSED")
    }) as unknown as typeof fetch

    const fetcher = createNet32SidecarFetcher({ fetchImpl })
    const result = await fetcher("https://www.net32.com/search?query=x")

    expect(result.ok).toBe(false)
    expect(result.status).toBe(0)
    expect(result.error).toContain("ECONNREFUSED")
  })
})
