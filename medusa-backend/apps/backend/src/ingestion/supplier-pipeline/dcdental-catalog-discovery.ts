import { downloadText } from "./sitemap-discovery"
import { normalizeSiteUrl } from "./suppliers"
import type {
  IndexedSupplierUrl,
  SupplierSeedRow,
} from "./types"

type DCDentalApiItem = {
  custitem_category_facet?: string
  custitem_quik_view_subcat2?: string
  internalid?: number | string
  itemid?: string
  storedisplayname2?: string
  storedescription?: string
  urlcomponent?: string
}

type DCDentalApiPage = {
  items?: DCDentalApiItem[]
  links?: Array<{ rel?: string; href?: string }>
}

type DCDentalCategoryPage = {
  distributor: string
  website_url: string
  origin: string
  prices: string
  source_url: string
  category_url: string
}

type DCDentalDiscoveryOptions = {
  timeoutMs?: number
  debug?: boolean
  concurrency?: number
  maxPages?: number
}

const DC_DENTAL_COMPANY_ID = "1075085"
const DC_DENTAL_SITE_ID = "3"

function debugLog(enabled: boolean | undefined, ...args: unknown[]) {
  if (enabled) {
    console.log("[dcdental-catalog-discovery]", ...args)
  }
}

function infoLog(...args: unknown[]) {
  console.log("[dcdental-catalog-discovery]", ...args)
}

function dcDentalSupplier(supplier: SupplierSeedRow) {
  try {
    const site = normalizeSiteUrl(supplier.website_url)
    return /dcdental\.com$/i.test(new URL(site.origin).hostname) ||
      /dc dental/i.test(supplier.distributor)
  } catch {
    return /dc dental/i.test(supplier.distributor)
  }
}

function dcDentalCategoryUrl(row: IndexedSupplierUrl) {
  try {
    const parsed = new URL(row.url)
    return /dcdental\.com$/i.test(parsed.hostname) &&
      row.url_type === "category" &&
      /^(?:\/Supplies|\/Small-Equipment|\/3M-Merchandise)(?:\/|$)/i.test(parsed.pathname)
  } catch {
    return false
  }
}

function categoryParts(categoryUrl: string, item?: DCDentalApiItem) {
  const fallback = new URL(categoryUrl).pathname
    .split("/")
    .filter(Boolean)
    .map((part) => part.replace(/[-_]+/g, " "))

  return {
    category: item?.custitem_category_facet || fallback[0] || "Dental supplies",
    subcategory: item?.custitem_quik_view_subcat2 || fallback.slice(1).join(" > "),
  }
}

function apiUrl(categoryUrl: string, apiHref?: string) {
  if (apiHref) {
    return apiHref
  }

  const parsed = new URL(categoryUrl)
  const params = new URLSearchParams({
    country: "US",
    pricelevel: "10",
    include: "facets",
    c: DC_DENTAL_COMPANY_ID,
    commercecategoryurl: parsed.pathname,
    fieldset: "search",
    limit: "50",
    currency: "USD",
    language: "en",
    n: DC_DENTAL_SITE_ID,
  })

  return `${parsed.origin}/api/items?${params.toString()}`
}

function parseApiPage(body: string): DCDentalApiPage {
  try {
    return JSON.parse(body) as DCDentalApiPage
  } catch {
    return {}
  }
}

function nextApiHref(page: DCDentalApiPage) {
  return page.links?.find((link) => link.rel === "next")?.href
}

function productUrl(origin: string, item: DCDentalApiItem) {
  if (!item.urlcomponent) {
    return ""
  }

  return new URL(`/${item.urlcomponent}`, origin).href
}

async function discoverCategoryProducts(
  category: DCDentalCategoryPage,
  options: DCDentalDiscoveryOptions
) {
  const products: IndexedSupplierUrl[] = []
  let nextHref = ""
  let pagesFetched = 0
  const maxPages = options.maxPages ?? 1

  for (let page = 0; page < maxPages; page += 1) {
    const url = apiUrl(category.category_url, nextHref)
    debugLog(options.debug, `Fetching category API ${url}`)
    const response = await downloadText(url, options.timeoutMs)

    if (!response.ok || !response.body) {
      debugLog(
        options.debug,
        `Category API failed: status=${response.status} url=${url}`
      )
      break
    }

    pagesFetched += 1
    const apiPage = parseApiPage(response.body)
    for (const item of apiPage.items ?? []) {
      const url = productUrl(category.origin, item)

      if (!url) {
        continue
      }

      products.push({
        distributor: category.distributor,
        website_url: category.website_url,
        origin: category.origin,
        prices: category.prices,
        sitemap_url: category.source_url,
        url,
        url_type: "product",
        confidence_score: 92,
        reasons: ["DC Dental category API product URL"],
        ...categoryParts(category.category_url, item),
      })
    }

    nextHref = nextApiHref(apiPage) ?? ""
    if (!nextHref) {
      break
    }
  }

  return {
    products,
    pagesFetched,
  }
}

export async function discoverDcDentalCatalogUrls(
  suppliers: SupplierSeedRow[],
  indexedUrls: IndexedSupplierUrl[],
  options: DCDentalDiscoveryOptions = {}
) {
  if (!suppliers.some(dcDentalSupplier)) {
    return [] as IndexedSupplierUrl[]
  }

  const seenCategories = new Set<string>()
  const categories = indexedUrls
    .filter(dcDentalCategoryUrl)
    .filter((row) => {
      if (seenCategories.has(row.url)) {
        return false
      }

      seenCategories.add(row.url)
      return true
    })
    .map((row): DCDentalCategoryPage => ({
      distributor: row.distributor,
      website_url: row.website_url,
      origin: row.origin,
      prices: row.prices,
      source_url: row.sitemap_url,
      category_url: row.url,
    }))

  if (!categories.length) {
    return [] as IndexedSupplierUrl[]
  }

  infoLog(
    `Discovering DC Dental products from ${categories.length} category URL(s)`
  )

  const products: IndexedSupplierUrl[] = []
  let remainingPages = options.maxPages ?? 50

  for (const category of categories) {
    if (remainingPages <= 0) {
      break
    }

    const result = await discoverCategoryProducts(category, {
      ...options,
      maxPages: remainingPages,
    })
    products.push(...result.products)
    remainingPages -= result.pagesFetched
    infoLog(
      `Category ${category.category_url}: ${result.pagesFetched} page(s), ${result.products.length} product URL(s), ${remainingPages} page budget left`
    )
  }

  const seenProducts = new Set<string>()

  return products.filter((row) => {
    if (seenProducts.has(row.url)) {
      return false
    }

    seenProducts.add(row.url)
    return true
  })
}
