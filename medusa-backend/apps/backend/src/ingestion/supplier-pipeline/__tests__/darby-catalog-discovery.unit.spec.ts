import {
  discoverDarbyItemUrls,
  isDarbyProductUrl,
  DARBY_SITEMAP_INDEX,
} from "../darby-catalog-discovery"

const INDEX_XML = `<?xml version="1.0"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap><loc>https://www.darbydental.com/media/sitemap-1-1.xml</loc></sitemap>
  <sitemap><loc>https://www.darbydental.com/media/sitemap-1-2.xml</loc></sitemap>
</sitemapindex>`

// sitemap-1-1: homepage + category pages only (no numeric product URLs).
const SITEMAP1 = `<?xml version="1.0"?>
<urlset>
  <url><loc>https://www.darbydental.com/</loc></url>
  <url><loc>https://www.darbydental.com/categories.html</loc></url>
  <url><loc>https://www.darbydental.com/categories/gloves.html</loc></url>
</urlset>`

// sitemap-1-2: numeric product pages, including a variant suffix + a dup.
const SITEMAP2 = `<?xml version="1.0"?>
<urlset>
  <url><loc>https://www.darbydental.com/9543404.html</loc></url>
  <url><loc>https://www.darbydental.com/5259695-01.html</loc></url>
  <url><loc>https://www.darbydental.com/9543404.html</loc></url>
</urlset>`

function fetcher(map: Record<string, string>) {
  return async (url: string) => map[url] ?? ""
}

describe("darby catalog discovery", () => {
  it("classifies numeric product URLs and rejects category/home URLs", () => {
    expect(isDarbyProductUrl("https://www.darbydental.com/9543404.html")).toBe(true)
    expect(isDarbyProductUrl("https://www.darbydental.com/5259695-01.html")).toBe(true)
    expect(isDarbyProductUrl("https://www.darbydental.com/categories/gloves.html")).toBe(false)
    expect(isDarbyProductUrl("https://www.darbydental.com/categories.html")).toBe(false)
    expect(isDarbyProductUrl("https://www.darbydental.com/")).toBe(false)
  })

  it("collects numeric product URLs, dropping duplicates and non-products", async () => {
    const urls = await discoverDarbyItemUrls({
      fetchText: fetcher({
        [DARBY_SITEMAP_INDEX]: INDEX_XML,
        "https://www.darbydental.com/media/sitemap-1-1.xml": SITEMAP1,
        "https://www.darbydental.com/media/sitemap-1-2.xml": SITEMAP2,
      }),
    })
    expect(urls).toEqual([
      "https://www.darbydental.com/9543404.html",
      "https://www.darbydental.com/5259695-01.html",
    ])
  })

  it("returns empty when the sitemap index can't be fetched", async () => {
    const urls = await discoverDarbyItemUrls({ fetchText: fetcher({}) })
    expect(urls).toEqual([])
  })

  it("honors maxUrls", async () => {
    const urls = await discoverDarbyItemUrls({
      fetchText: fetcher({
        [DARBY_SITEMAP_INDEX]: INDEX_XML,
        "https://www.darbydental.com/media/sitemap-1-1.xml": SITEMAP1,
        "https://www.darbydental.com/media/sitemap-1-2.xml": SITEMAP2,
      }),
      maxUrls: 1,
    })
    expect(urls).toHaveLength(1)
  })
})
