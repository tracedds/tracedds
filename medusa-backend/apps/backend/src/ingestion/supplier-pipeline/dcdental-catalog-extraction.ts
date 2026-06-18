import { stripTags } from "./html"
import { downloadText } from "./sitemap-discovery"
import { normalizeSiteUrl } from "./suppliers"
import {
  apiImageValues,
  availability,
  normalizeBarcode,
  packSize,
  price,
} from "./adapters/dcdental"
import type {
  ExtractedProductRow,
  ProductExtractionResult,
  ProductPageCandidate,
  SupplierSeedRow,
} from "./types"

// DC Dental runs on NetSuite SuiteCommerce. Its /api/items endpoint paginates
// the ENTIRE catalog by offset (no category filter), so a single offset walk
// returns every distinct item exactly once — unlike the per-category crawl,
// which re-paginates products shared across categories and needs an unbounded
// page budget. An explicit `fields` list (not fieldset=details) returns the
// GTIN/UPC `upccode` alongside the nested price/image objects the row needs.
const DC_DENTAL_COMPANY_ID = "1075085"
const DC_DENTAL_SITE_ID = "3"
const CATALOG_PAGE_SIZE = 100
// Safety ceiling so a malformed `total` can't loop forever. The live catalog is
// ~40k items (~400 pages); 5000 pages = 500k items is comfortably out of reach.
const MAX_CATALOG_PAGES = 5000
const PAGE_FETCH_ATTEMPTS = 3

const CATALOG_FIELDS = [
  "internalid", "itemid", "upccode", "manufacturer",
  "storedisplayname2", "storedescription", "storedetaileddescription",
  "custitem_quik_view_subcat2", "custitem_dc_specs",
  "onlinecustomerprice_detail", "isinstock", "isbackorderable",
  "quantityavailable", "urlcomponent", "itemimages_detail", "itemimages", "itemimage",
].join(",")
const DISCOVERY_FIELDS = ["internalid", "itemid", "urlcomponent"].join(",")

type DcDentalCatalogItem = {
  internalid?: number | string
  itemid?: string
  upccode?: string
  manufacturer?: string
  storedisplayname2?: string
  storedescription?: string
  storedetaileddescription?: string
  custitem_quik_view_subcat2?: string
  custitem_dc_specs?: string
  urlcomponent?: string
  quantityavailable?: number
  isinstock?: boolean
  isbackorderable?: boolean
  onlinecustomerprice_detail?: {
    onlinecustomerprice?: number
    onlinecustomerprice_formatted?: string
  }
  itemimage?: unknown
  itemimages?: unknown
  itemimages_detail?: unknown
}

type DcDentalCatalogPage = {
  total?: number
  items?: DcDentalCatalogItem[]
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function dcDentalSupplier(supplier: SupplierSeedRow) {
  try {
    const site = normalizeSiteUrl(supplier.website_url)
    return /dcdental\.com$/i.test(new URL(site.origin).hostname) ||
      /dc dental/i.test(supplier.distributor)
  } catch {
    return /dc dental/i.test(supplier.distributor)
  }
}

function isDcDentalCandidate(candidate: ProductPageCandidate) {
  try {
    return /dcdental\.com$/i.test(new URL(candidate.url).hostname)
  } catch {
    return false
  }
}

function supplierOrigin(supplier: SupplierSeedRow) {
  try {
    return new URL(normalizeSiteUrl(supplier.website_url).origin).origin
  } catch {
    return "https://www.dcdental.com"
  }
}

function catalogPageUrl(origin: string, offset: number, fields: string) {
  const params = new URLSearchParams({
    c: DC_DENTAL_COMPANY_ID,
    country: "US",
    currency: "USD",
    language: "en",
    n: DC_DENTAL_SITE_ID,
    pricelevel: "10",
    fields,
    limit: String(CATALOG_PAGE_SIZE),
    offset: String(offset),
  })
  return `${origin}/api/items?${params.toString()}`
}

function productUrl(origin: string, item: DcDentalCatalogItem) {
  if (!item.urlcomponent) {
    return ""
  }

  try {
    return new URL(`/${item.urlcomponent}`, origin).href
  } catch {
    return ""
  }
}

// Walk the whole catalog by offset. All-or-nothing: every page is retried, and
// any page that still fails throws — we must never return a partial catalog,
// because the commit replaces the supplier by deleting everything first.
async function fetchCatalogItems(
  origin: string,
  fields: string,
  options: { timeoutMs?: number } = {}
): Promise<DcDentalCatalogItem[]> {
  const items: DcDentalCatalogItem[] = []
  let total = Number.POSITIVE_INFINITY

  for (let page = 0; page < MAX_CATALOG_PAGES; page += 1) {
    const offset = page * CATALOG_PAGE_SIZE
    if (offset >= total) {
      break
    }

    const url = catalogPageUrl(origin, offset, fields)
    let body = ""
    for (let attempt = 1; attempt <= PAGE_FETCH_ATTEMPTS; attempt += 1) {
      const response = await downloadText(url, options.timeoutMs)
      if (response.ok && response.body) {
        body = response.body
        break
      }
      if (attempt === PAGE_FETCH_ATTEMPTS) {
        throw new Error(
          `DC Dental catalog fetch failed at offset ${offset} (status ${response.status}); aborting to avoid a partial replace`
        )
      }
      await sleep(500 * attempt)
    }

    let parsed: DcDentalCatalogPage
    try {
      parsed = JSON.parse(body) as DcDentalCatalogPage
    } catch {
      throw new Error(`DC Dental catalog returned non-JSON at offset ${offset}; aborting`)
    }

    if (typeof parsed.total === "number") {
      total = parsed.total
    }
    const pageItems = parsed.items ?? []
    if (!pageItems.length) {
      break
    }
    items.push(...pageItems)
  }

  if (Number.isFinite(total) && items.length < total) {
    throw new Error(
      `DC Dental catalog incomplete: collected ${items.length} of ${total} items; aborting to avoid a partial replace`
    )
  }

  return items
}

// itemimages_detail is shaped { urls: [{ url, altimagetext }] }, which the
// adapter's apiImageValues (url/src/fullurl/... keys) does not traverse — the
// per-product path got images from page HTML instead. Pull the urls array here.
function detailImageUrls(detail: unknown): string[] {
  if (!detail || typeof detail !== "object") {
    return []
  }
  const urls = (detail as { urls?: unknown }).urls
  if (!Array.isArray(urls)) {
    return apiImageValues(detail)
  }
  return urls.flatMap((entry) => {
    if (typeof entry === "string") {
      return [entry]
    }
    if (entry && typeof entry === "object") {
      const url = (entry as { url?: unknown }).url
      return typeof url === "string" ? [url] : []
    }
    return []
  })
}

function imageUrls(origin: string, item: DcDentalCatalogItem) {
  const apiImages = [
    ...apiImageValues(item.itemimage),
    ...apiImageValues(item.itemimages),
    ...detailImageUrls(item.itemimages_detail),
  ]
  return [
    ...new Set(
      apiImages
        .map((url) => {
          try {
            return new URL(url, origin).href
          } catch {
            return ""
          }
        })
        .filter(Boolean)
    ),
  ]
}

// storedisplayname2 is usually the product name but is occasionally just the
// SKU; fall back to the (tag-stripped) store description before using the SKU.
function productName(item: DcDentalCatalogItem, sku: string) {
  const display = item.storedisplayname2?.trim() || ""
  const described = stripTags(item.storedescription ?? "").trim()
  if (display && display !== sku) {
    return display
  }
  return described || display || sku
}

export function dcDentalItemToRow(item: DcDentalCatalogItem, origin: string): ExtractedProductRow {
  const sku = item.itemid?.trim() || ""
  const name = productName(item, sku)
  const description = stripTags(item.storedetaileddescription ?? "").trim() || name
  const subcategory = item.custitem_quik_view_subcat2?.trim() || ""
  const images = imageUrls(origin, item)
  const url = productUrl(origin, item)

  return {
    sku,
    manufacturer_sku: sku,
    barcode: normalizeBarcode(item),
    brand: item.manufacturer ?? "",
    name,
    description,
    category: subcategory || "Dental supplies",
    subcategory,
    product_line: subcategory,
    product_url: url,
    image_url: images[0] ?? "",
    pack_size: packSize(`${name} ${description} ${item.custitem_dc_specs ?? ""}`),
    unit_of_measure: "",
    price: price(item),
    price_basis: "each",
    availability: availability(item),
    min_quantity: 1,
    raw: {
      extracted_by: "dcdental-catalog-api",
      internalid: item.internalid,
      quantityavailable: item.quantityavailable,
      source_page_url: url || origin,
      image_urls: images,
    },
  }
}

// Index-stage helper: enumerate every product URL once via the flat catalog walk
// (lightweight fields). Replaces the per-category crawl, which truncated under a
// page-budget cap because shared products re-paginate in each category.
export async function discoverDcDentalCatalogProductUrls(
  suppliers: SupplierSeedRow[],
  options: { timeoutMs?: number } = {}
): Promise<{ supplier: SupplierSeedRow; origin: string; urls: string[] } | null> {
  const supplier = suppliers.find(dcDentalSupplier)
  if (!supplier) {
    return null
  }

  const origin = supplierOrigin(supplier)
  const items = await fetchCatalogItems(origin, DISCOVERY_FIELDS, options)
  const seen = new Set<string>()
  const urls: string[] = []
  for (const item of items) {
    const sku = item.itemid?.trim()
    if (!sku || seen.has(sku)) {
      continue
    }
    seen.add(sku)
    urls.push(productUrl(origin, item) || `${origin}/item-${item.internalid ?? sku}`)
  }
  return { supplier, origin, urls }
}

// Extract-stage pre-pass mirroring the Shopify products.json pre-pass: produce
// every DC Dental row (with barcode) directly from the flat catalog API, and
// drop DC Dental candidates from `remaining` so per-product extraction skips them.
export async function extractDcDentalCatalogProducts(
  candidates: ProductPageCandidate[],
  suppliers: SupplierSeedRow[],
  options: { timeoutMs?: number } = {}
): Promise<ProductExtractionResult & { remaining: ProductPageCandidate[] }> {
  const supplier = suppliers.find(dcDentalSupplier)
  if (!supplier) {
    return { products: [], failures: [], remaining: candidates }
  }

  const origin = supplierOrigin(supplier)
  const remaining = candidates.filter((candidate) => !isDcDentalCandidate(candidate))
  const items = await fetchCatalogItems(origin, CATALOG_FIELDS, options)

  const seen = new Set<string>()
  const products: ExtractedProductRow[] = []
  for (const item of items) {
    const sku = item.itemid?.trim()
    if (!sku || seen.has(sku)) {
      continue
    }
    seen.add(sku)
    products.push(dcDentalItemToRow(item, origin))
  }

  return { products, failures: [], remaining }
}
