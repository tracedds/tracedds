import {
  discoverPattersonItemUrls,
  PATTERSON_SITEMAP_INDEX,
} from "../patterson-catalog-discovery"

const INDEX_XML = `<?xml version="1.0"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap><loc>https://www.pattersondental.com/sitemap1.xml</loc></sitemap>
  <sitemap><loc>https://www.pattersondental.com/sitemap2.xml</loc></sitemap>
</sitemapindex>`

// sitemap1: category/search pages only (no ItemDetail).
const SITEMAP1 = `<?xml version="1.0"?>
<urlset>
  <url><loc>https://www.pattersondental.com/Supplies/Deals</loc></url>
  <url><loc>https://www.pattersondental.com/Catalog/Search?taxonomyId=782&amp;p=2</loc></url>
</urlset>`

// sitemap2: product pages, including a US/CA duplicate and a query-suffixed dup.
const SITEMAP2 = `<?xml version="1.0"?>
<urlset>
  <url><loc>https://www.pattersondental.com/Supplies/ItemDetail/070107516</loc></url>
  <url><loc>https://www.pattersondental.com/Supplies/ItemDetail/050482067</loc></url>
  <url><loc>https://www.pattersondental.com/en-CA/Supplies/ItemDetail/070107516</loc></url>
  <url><loc>https://www.pattersondental.com/Supplies/ItemDetail/070107516?tab=specs</loc></url>
</urlset>`

function fetcher(map: Record<string, string>) {
  return async (url: string) => map[url] ?? ""
}

describe("patterson catalog discovery", () => {
  it("collects US ItemDetail URLs, dropping locale + query duplicates", async () => {
    const urls = await discoverPattersonItemUrls({
      fetchText: fetcher({
        [PATTERSON_SITEMAP_INDEX]: INDEX_XML,
        "https://www.pattersondental.com/sitemap1.xml": SITEMAP1,
        "https://www.pattersondental.com/sitemap2.xml": SITEMAP2,
      }),
    })
    expect(urls).toEqual([
      "https://www.pattersondental.com/Supplies/ItemDetail/070107516",
      "https://www.pattersondental.com/Supplies/ItemDetail/050482067",
    ])
  })

  it("returns empty when the sitemap index can't be fetched", async () => {
    const urls = await discoverPattersonItemUrls({ fetchText: fetcher({}) })
    expect(urls).toEqual([])
  })

  it("honors maxUrls", async () => {
    const urls = await discoverPattersonItemUrls({
      fetchText: fetcher({
        [PATTERSON_SITEMAP_INDEX]: INDEX_XML,
        "https://www.pattersondental.com/sitemap1.xml": SITEMAP1,
        "https://www.pattersondental.com/sitemap2.xml": SITEMAP2,
      }),
      maxUrls: 1,
    })
    expect(urls).toHaveLength(1)
  })
})
