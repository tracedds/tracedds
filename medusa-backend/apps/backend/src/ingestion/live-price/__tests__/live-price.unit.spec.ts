import {
  fetchLivePriceCents,
  livePriceProviderFor,
  supportsLivePrice,
  parsePattersonAuthedPriceCents,
  parseHenryScheinAuthedPriceCents,
} from ".."

// Patterson ships the item model HTML-entity-encoded; logged out UnitPrice is
// null, logged in (our assumption) it carries the account's price.
const pattersonAuthed = (body: string) =>
  `<input id="ItemSkuDetail_PublicItemNumber" value="070107516" /><script>var model = {${body}};</script>`

describe("patterson live price", () => {
  it("returns null when logged out (UnitPrice null)", () => {
    const html = pattersonAuthed(`&quot;UnitPrice&quot;:null,&quot;UnitPriceOverride&quot;:null`)
    expect(parsePattersonAuthedPriceCents(html)).toBeNull()
  })

  it("parses a populated numeric UnitPrice to cents", () => {
    const html = pattersonAuthed(`&quot;UnitPrice&quot;:12.34,&quot;UnitPriceOverride&quot;:null`)
    expect(parsePattersonAuthedPriceCents(html)).toBe(1234)
  })

  it("prefers a non-null UnitPriceOverride over UnitPrice", () => {
    const html = pattersonAuthed(`&quot;UnitPrice&quot;:12.34,&quot;UnitPriceOverride&quot;:9.99`)
    expect(parsePattersonAuthedPriceCents(html)).toBe(999)
  })

  it("handles a quoted / $-prefixed string price", () => {
    const html = pattersonAuthed(`&quot;UnitPrice&quot;:&quot;$1,250.00&quot;`)
    expect(parsePattersonAuthedPriceCents(html)).toBe(125000)
  })
})

// Henry Schein ships JSON-LD; logged out offers.price is "0.00", logged in (our
// assumption) it carries the account price.
const hsJsonLd = (price: string) =>
  `<script type="application/ld+json">{"@type":"Product","name":"X","sku":"1014583","offers":{"@type":"Offer","price":"${price}","priceCurrency":"USD"}}</script>`

describe("henry schein live price", () => {
  it("returns null for the logged-out 0.00 price", () => {
    expect(parseHenryScheinAuthedPriceCents(hsJsonLd("0.00"))).toBeNull()
  })

  it("parses a populated offers.price to cents", () => {
    expect(parseHenryScheinAuthedPriceCents(hsJsonLd("46.79"))).toBe(4679)
  })
})

describe("registry + fetch seam", () => {
  it("knows which suppliers support live price", () => {
    expect(supportsLivePrice("msup_pattersondental_com")).toBe(true)
    expect(supportsLivePrice("msup_henryschein_com")).toBe(true)
    expect(supportsLivePrice("msup_dcdental_com")).toBe(false)
    expect(livePriceProviderFor("msup_dcdental_com")).toBeUndefined()
  })

  it("builds the Patterson URL from a sku and parses via the injected authed fetch", async () => {
    const seen: string[] = []
    const result = await fetchLivePriceCents({
      supplier_id: "msup_pattersondental_com",
      sku: "070107516",
      authedFetch: async (url) => {
        seen.push(url)
        return pattersonAuthed(`&quot;UnitPrice&quot;:12.34`)
      },
    })
    expect(seen).toEqual(["https://www.pattersondental.com/Supplies/ItemDetail/070107516"])
    expect(result.price_cents).toBe(1234)
    expect(result.source).toBe("authenticated-live")
  })

  it("returns null price (not a throw) when the authed fetch fails", async () => {
    const result = await fetchLivePriceCents({
      supplier_id: "msup_pattersondental_com",
      url: "https://x",
      authedFetch: async () => {
        throw new Error("login expired")
      },
    })
    expect(result.price_cents).toBeNull()
  })

  it("returns null for a supplier without a live-price provider", async () => {
    const result = await fetchLivePriceCents({
      supplier_id: "msup_dcdental_com",
      url: "https://x",
      authedFetch: async () => "<html></html>",
    })
    expect(result.price_cents).toBeNull()
  })
})
