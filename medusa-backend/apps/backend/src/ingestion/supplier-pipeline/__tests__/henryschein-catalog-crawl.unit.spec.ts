import {
  crawlHenryScheinCatalog,
  HS_TOP_CATEGORY_FALLBACK,
  type HenryScheinCrawlSummary,
} from "../henryschein-catalog-crawl"

// Build a listing page with N product JSON-LD blocks.
function listing(skus: string[], subcatPaths: string[] = []): string {
  const products = skus
    .map(
      (sku) =>
        `<script type="application/ld+json">{"@type":"Product","name":"Product ${sku}","sku":"${sku}","brand":{"@type":"Organization","name":"Acme"},"url":"https://www.henryschein.com/us-en/dental/p/x/y/z/${sku}","mpn":"MPN-${sku}"}</script>`
    )
    .join("\n")
  const links = subcatPaths
    .map((p) => `<a href="https://www.henryschein.com/us-en/dental/c/${p}">x</a>`)
    .join("\n")
  return `<html><body>${links}${products}</body></html>`
}

// Category graph: gloves hub → {nitrile, latex} leaves; nitrile paginates 2 pages.
const C = "https://www.henryschein.com/us-en/dental/c"
const GRAPH: Record<string, string> = {
  [`${C}/gloves`]: listing([], ["gloves/nitrile", "gloves/latex"]),
  [`${C}/gloves/nitrile`]: listing(["A", "B"]),
  [`${C}/gloves/nitrile?pageNumber=2`]: listing(["C"]),
  [`${C}/gloves/nitrile?pageNumber=3`]: listing([]), // empty → stop
  [`${C}/gloves/latex`]: listing(["D"]),
  [`${C}/gloves/latex?pageNumber=2`]: listing([]),
}

describe("crawlHenryScheinCatalog", () => {
  it("walks hub → leaves, paginates listings, and dedupes products by sku", async () => {
    const fetched: string[] = []
    const fetchHtml = async (url: string) => {
      fetched.push(url)
      return GRAPH[url] ?? ""
    }

    const rows = await crawlHenryScheinCatalog({
      fetchHtml,
      seedUrls: [`${C}/gloves`],
      concurrency: 2,
    })

    const skus = rows.map((r) => r.sku).sort()
    expect(skus).toEqual(["A", "B", "C", "D"])
    // Followed subcategory links discovered on the hub page.
    expect(fetched).toContain(`${C}/gloves/nitrile`)
    expect(fetched).toContain(`${C}/gloves/latex`)
    // Paginated nitrile until the empty page; never fetched a 4th page.
    expect(fetched).toContain(`${C}/gloves/nitrile?pageNumber=2`)
    expect(fetched).not.toContain(`${C}/gloves/nitrile?pageNumber=4`)
    // Identity-only rows (no price).
    expect(rows.every((r) => r.price_cents === undefined)).toBe(true)
  })

  it("respects the global page cap", async () => {
    let calls = 0
    const fetchHtml = async (url: string) => {
      calls++
      return GRAPH[url] ?? ""
    }
    await crawlHenryScheinCatalog({
      fetchHtml,
      seedUrls: [`${C}/gloves`],
      maxPages: 2,
      concurrency: 1,
    })
    expect(calls).toBeLessThanOrEqual(3) // stops shortly after the cap
  })

  it("continues beyond page 60 when a category still has products", async () => {
    const base = `${C}/burs-diamonds/diamond-burs`
    const fetchHtml = async (url: string) => {
      if (url === base) return listing(["P1"])
      const page = Number(new URL(url).searchParams.get("pageNumber"))
      return page <= 61 ? listing([`P${page}`]) : listing([])
    }

    const rows = await crawlHenryScheinCatalog({
      fetchHtml,
      seedUrls: [base],
      concurrency: 1,
    })

    expect(rows.map((row) => row.sku)).toContain("P61")
    expect(rows).toHaveLength(61)
  })

  it("does not stop a category because another category already supplied the page's SKUs", async () => {
    const first = `${C}/overlap/first`
    const second = `${C}/overlap/second`
    const pages: Record<string, string> = {
      [first]: listing(["SHARED"]),
      [`${first}?pageNumber=2`]: listing([]),
      [second]: listing(["SECOND-1"]),
      [`${second}?pageNumber=2`]: listing(["SHARED"]),
      [`${second}?pageNumber=3`]: listing(["SECOND-3"]),
      [`${second}?pageNumber=4`]: listing([]),
    }

    const rows = await crawlHenryScheinCatalog({
      fetchHtml: async (url) => pages[url] ?? "",
      seedUrls: [first, second],
      concurrency: 1,
    })

    expect(rows.map((row) => row.sku).sort()).toEqual([
      "SECOND-1",
      "SECOND-3",
      "SHARED",
    ])
  })

  it("reports an incomplete crawl when a safety cap truncates a category", async () => {
    const base = `${C}/large-category`
    let summary: HenryScheinCrawlSummary | undefined
    await crawlHenryScheinCatalog({
      fetchHtml: async (url) => {
        const page = url === base ? 1 : Number(new URL(url).searchParams.get("pageNumber"))
        return listing([`P${page}`])
      },
      seedUrls: [base],
      maxPagesPerNode: 3,
      concurrency: 1,
      onSummary: (value) => {
        summary = value
      },
    })

    expect(summary).toMatchObject({ complete: false, capHit: false })
    expect(summary?.truncatedCategories).toEqual([base])
  })

  it("keeps the offline fallback aligned with every current top-level department", () => {
    expect(HS_TOP_CATEGORY_FALLBACK).toContain(`${C}/education-patient-staff`)
    expect(HS_TOP_CATEGORY_FALLBACK).toContain(`${C}/practice-marketing`)
  })

  it("finishes after draining duplicate category links", async () => {
    const base = `${C}/duplicate`
    const rows = await Promise.race([
      crawlHenryScheinCatalog({
        fetchHtml: async () => listing([]),
        seedUrls: [base, base],
        concurrency: 1,
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("crawl did not resolve")), 100)
      ),
    ])

    expect(rows).toEqual([])
  })
})
