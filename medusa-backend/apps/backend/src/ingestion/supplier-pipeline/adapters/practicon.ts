import {
  firstMatch,
  metaContent,
  productImageUrls,
  stringValue,
  stripTags,
} from "../html"
import type {
  ExtractedProductRow,
  ProductPageCandidate,
  SupplierProductAdapter,
} from "../types"

type PracticonPrice = {
  value?: number
}

type PracticonAttributes = {
  sku?: string | null
  upc?: string | null
  mpn?: string | null
  gtin?: string | null
  price?: {
    without_tax?: PracticonPrice
    sale_price_without_tax?: PracticonPrice
  }
}

/**
 * Practicon (practicon.com) runs on BigCommerce. Product pages carry the SKU,
 * MPN, UPC/GTIN and price inside the `var BCData = {...}` storefront data layer
 * (the only ld+json on the page is a BreadcrumbList), so we parse that object
 * for the structured fields and fall back to the schema.org microdata in the
 * markup for the name and brand.
 */
function balancedObject(source: string, startBraceIndex: number) {
  let depth = 0
  let inString = false
  let escaped = false

  for (let i = startBraceIndex; i < source.length; i++) {
    const char = source[i]

    if (inString) {
      if (escaped) {
        escaped = false
      } else if (char === "\\") {
        escaped = true
      } else if (char === '"') {
        inString = false
      }
      continue
    }

    if (char === '"') {
      inString = true
    } else if (char === "{") {
      depth += 1
    } else if (char === "}") {
      depth -= 1
      if (depth === 0) {
        return source.slice(startBraceIndex, i + 1)
      }
    }
  }

  return ""
}

function productAttributes(html: string): PracticonAttributes | undefined {
  const marker = html.indexOf("var BCData")
  if (marker === -1) {
    return undefined
  }

  const brace = html.indexOf("{", marker)
  if (brace === -1) {
    return undefined
  }

  try {
    const data = JSON.parse(balancedObject(html, brace)) as {
      product_attributes?: PracticonAttributes
    }
    return data.product_attributes
  } catch {
    return undefined
  }
}

function priceString(attrs: PracticonAttributes | undefined) {
  const value =
    attrs?.price?.sale_price_without_tax?.value ??
    attrs?.price?.without_tax?.value

  return typeof value === "number" && Number.isFinite(value)
    ? value.toFixed(2)
    : ""
}

function normalizeBarcode(value: unknown) {
  const raw = String(value ?? "").trim()
  return /^\d{8,14}$/.test(raw) ? raw : ""
}

function breadcrumbNames(html: string) {
  const nav = firstMatch(html, [
    /<nav[^>]*id=["']nav-breadcrumbs["'][^>]*>([\s\S]*?)<\/nav>/i,
  ])

  return [...nav.matchAll(/itemprop=["']name["'][^>]*>([\s\S]*?)<\/span>/gi)]
    .map((match) => stripTags(match[1]))
    .filter(Boolean)
}

/**
 * Practicon breadcrumbs look like:
 * Home / Shop by Category / Sterilization & Infection Prevention /
 *   Barrier Protection / Handpieces & Small Control / <product name>
 * Drop the generic "Home"/"Shop by Category" prefix and the trailing product
 * name, keeping the taxonomy levels.
 */
function categoryParts(html: string) {
  const names = breadcrumbNames(html).filter(
    (name) => !/^home$/i.test(name) && !/^shop by category$/i.test(name)
  )
  const taxonomy = names.slice(0, Math.max(0, names.length - 1))

  return {
    category: taxonomy[0] || "Dental supplies",
    subcategory: taxonomy[1] || "",
    product_line: taxonomy[2] || "",
  }
}

function packSize(value: string) {
  return firstMatch(value, [
    /([0-9][0-9,]*\s*\/\s*(?:bag|box|case|pack|pkg|bottle|tube|syringe|unit|cartridge|pk|bx)s?)/i,
    /((?:bag|box|case|pack|pkg|bottle|tube|syringe|unit|cartridge|pk|bx)s?\s+of\s+[0-9][A-Za-z0-9/-]*)/i,
  ])
}

function availability(html: string) {
  const raw = metaContent(html, [
    "og:availability",
    "product:availability",
  ]).toLowerCase()

  if (raw.includes("instock") || raw.includes("in_stock")) {
    return "in_stock" as const
  }

  if (raw.includes("preorder") || raw.includes("backorder")) {
    return "backordered" as const
  }

  return "unknown" as const
}

function extractProduct(
  candidate: ProductPageCandidate,
  html: string
): ExtractedProductRow {
  const attrs = productAttributes(html)
  const name =
    stripTags(
      firstMatch(html, [
        /<h1[^>]*class=["'][^"']*productView-title[^"']*["'][^>]*>([\s\S]*?)<\/h1>/i,
      ])
    ) || metaContent(html, ["og:title"])
  const description = metaContent(html, ["og:description", "description"]) || name
  const sku =
    stringValue(attrs?.sku) ||
    firstMatch(html, [/itemprop=["']sku["'][^>]*>([^<]+)</i])
  const mpn =
    stringValue(attrs?.mpn) ||
    firstMatch(html, [/itemprop=["']mpn["'][^>]*content=["']([^"']+)["']/i])
  const brand = firstMatch(html, [
    /productView-brand[\s\S]{0,300}?<span[^>]*itemprop=["']name["'][^>]*>([\s\S]*?)<\/span>/i,
  ])
  const { category, subcategory, product_line } = categoryParts(html)
  const images = productImageUrls(html, candidate.url)

  return {
    sku,
    manufacturer_sku: mpn || sku,
    barcode: normalizeBarcode(attrs?.gtin ?? attrs?.upc),
    brand,
    name,
    description: description || name,
    category,
    subcategory,
    product_line,
    product_url: candidate.url,
    image_url: images[0] ?? "",
    pack_size: packSize(`${name} ${description}`),
    unit_of_measure: "",
    price: priceString(attrs),
    price_basis: "each",
    availability: availability(html),
    min_quantity: 1,
    raw: {
      extracted_by: "practicon",
      image_urls: images,
      source_page_url: candidate.url,
      sitemap_url: candidate.sitemap_url,
      confidence_score: candidate.confidence_score,
      reasons: candidate.reasons,
    },
  }
}

export const practiconAdapter: SupplierProductAdapter = {
  id: "practicon",
  matches: (candidate: ProductPageCandidate) =>
    /practicon\.com/i.test(candidate.url) ||
    /practicon/i.test(candidate.distributor),
  extractProduct,
}
