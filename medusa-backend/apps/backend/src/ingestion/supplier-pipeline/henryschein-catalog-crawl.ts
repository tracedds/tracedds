import {
  extractHenryScheinCategoryLinks,
  extractHenryScheinProducts,
} from "./adapters/henryschein"
import type { ExtractedProductRow } from "./types"

/**
 * Full Henry Schein dental catalog crawl.
 *
 * HS has no usable sitemap and its category hub pages load products via ASP.NET
 * postback, but the LEAF category pages (e.g. /us-en/dental/c/gloves/nitrile)
 * render every product as server-side JSON-LD and paginate with ?pageNumber=N.
 * So we BFS the category tree from the top categories, harvesting subcategory
 * links + products at each node, and paginate any node that lists products until
 * a page is empty or repeats SKUs already seen within that same category.
 *
 * Pure orchestration with an injected fetchHtml so it can be unit-tested against
 * a canned category graph; the ingest script supplies the real (browser-UA,
 * retrying) fetch.
 */

export const HS_DENTAL_BROWSE_ROOT =
  "https://www.henryschein.com/us-en/dental/c/browsesupplies"

// Fallback top categories if the browse root can't be fetched (keeps a run from
// failing on a transient root error). Matches the live /c/browsesupplies tree.
export const HS_TOP_CATEGORY_FALLBACK = [
  "anesthetics", "burs-diamonds", "cad-cam", "crown-bridge",
  "dental-equipment-parts-and-accessories", "disposables",
  "education-patient-staff", "endodontics",
  "equipment-technology", "evacuation-products", "finishing-polishing",
  "gloves", "handpieces", "health-beauty-otc",
  "impression-materials-accessories", "infection-control-products",
  "instruments", "laboratory", "medical-diagnostic-emergency", "miscellaneous",
  "office-management-supplies", "orthodontic", "pharmaceuticals",
  "practice-marketing", "preventive",
  "restorative-cosmetic", "small-equipment", "surgical-implant-products",
  "uniforms-work-wear", "x-ray-and-digital-imaging",
].map((slug) => `https://www.henryschein.com/us-en/dental/c/${slug}`)

export type CrawlDeps = {
  fetchHtml: (url: string) => Promise<string>
  seedUrls: string[]
  log?: (msg: string) => void
  maxPages?: number // global cap on page fetches
  maxPagesPerNode?: number // pagination cap per category
  maxProducts?: number
  concurrency?: number
  onSummary?: (summary: HenryScheinCrawlSummary) => void
}

export type HenryScheinCrawlSummary = {
  pages: number
  products: number
  categories: number
  complete: boolean
  capHit: boolean
  failedUrls: string[]
  truncatedCategories: string[]
  queuedCategories: number
}

export async function crawlHenryScheinCatalog(
  deps: CrawlDeps
): Promise<ExtractedProductRow[]> {
  const {
    fetchHtml,
    seedUrls,
    log = () => {},
    maxPages = 12000,
    maxPagesPerNode = 500,
    maxProducts = Infinity,
    concurrency = 4,
    onSummary = () => {},
  } = deps

  const bySku = new Map<string, ExtractedProductRow>()
  const visited = new Set<string>()
  const queue: string[] = []
  const failedUrls = new Set<string>()
  const truncatedCategories = new Set<string>()
  let pages = 0

  for (const url of seedUrls) if (!visited.has(url)) queue.push(url)

  const capHit = () => pages >= maxPages || bySku.size >= maxProducts

  const harvest = (rows: ExtractedProductRow[]): number => {
    let added = 0
    for (const row of rows) {
      if (!row.sku || bySku.has(row.sku)) continue
      bySku.set(row.sku, row)
      added++
      if (bySku.size >= maxProducts) break
    }
    return added
  }

  // Fetch a category's page 1 (subcats + products), then paginate while that
  // category keeps adding SKUs. Returns links discovered on page 1.
  const processNode = async (baseUrl: string): Promise<string[]> => {
    const first = await fetchHtml(baseUrl)
    pages++
    if (!first) {
      failedUrls.add(baseUrl)
      return []
    }

    const subcats = extractHenryScheinCategoryLinks(first)
    const firstRows = extractHenryScheinProducts(first)
    harvest(firstRows)
    const looksLikeListing = firstRows.length > 0 || /"@type"\s*:\s*"Product"/.test(first)

    if (looksLikeListing) {
      const seenInNode = new Set(firstRows.map((row) => row.sku).filter(Boolean))
      for (let pg = 2; pg <= maxPagesPerNode; pg++) {
        if (capHit()) break
        const pageUrl = `${baseUrl}?pageNumber=${pg}`
        const html = await fetchHtml(pageUrl)
        pages++
        if (!html) {
          failedUrls.add(pageUrl)
          break
        }

        const pageRows = extractHenryScheinProducts(html)
        if (pageRows.length === 0) break

        // Categories overlap. A valid page may contain only SKUs already seen
        // in another category, so global dedupe cannot be the end-of-list
        // signal. Stop only when this category repeats its own prior page data.
        let newInNode = 0
        for (const row of pageRows) {
          if (!row.sku || seenInNode.has(row.sku)) continue
          seenInNode.add(row.sku)
          newInNode++
        }
        harvest(pageRows)
        if (newInNode === 0) break
        if (pg === maxPagesPerNode) truncatedCategories.add(baseUrl)
      }
    }
    return subcats
  }

  // Concurrency-limited BFS over the category queue.
  await new Promise<void>((resolve) => {
    let active = 0

    const pump = () => {
      if (active === 0 && (queue.length === 0 || capHit())) {
        resolve()
        return
      }
      while (active < concurrency && queue.length > 0 && !capHit()) {
        const url = queue.shift() as string
        if (visited.has(url)) continue
        visited.add(url)
        active++
        processNode(url)
          .then((subcats) => {
            for (const c of subcats) if (!visited.has(c)) queue.push(c)
            log(
              `[henryschein] crawled ${url.replace("https://www.henryschein.com/us-en/dental/c/", "")} | pages=${pages} products=${bySku.size} queue=${queue.length}`
            )
          })
          .catch(() => failedUrls.add(url))
          .finally(() => {
            active--
            pump()
          })
      }
      // The queue can contain duplicate links that were visited while another
      // branch was active. If this pump drained only duplicates, no task will
      // reach finally() to call pump again, so resolve here as well.
      if (active === 0 && (queue.length === 0 || capHit())) resolve()
    }

    pump()
  })

  const summary: HenryScheinCrawlSummary = {
    pages,
    products: bySku.size,
    categories: visited.size,
    complete:
      queue.length === 0 &&
      !capHit() &&
      failedUrls.size === 0 &&
      truncatedCategories.size === 0,
    capHit: capHit(),
    failedUrls: [...failedUrls],
    truncatedCategories: [...truncatedCategories],
    queuedCategories: queue.length,
  }
  onSummary(summary)
  log(
    `[henryschein] crawl summary | pages=${summary.pages} products=${summary.products} ` +
      `categories=${summary.categories} complete=${summary.complete} failures=${summary.failedUrls.length} ` +
      `truncated=${summary.truncatedCategories.length} queued=${summary.queuedCategories}`
  )

  return [...bySku.values()]
}
