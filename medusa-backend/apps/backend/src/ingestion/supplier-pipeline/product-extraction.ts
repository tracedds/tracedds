import { adapterForCandidate } from "./adapters"
import type {
  FailedProductExtraction,
  ProductExtractionResult,
  ProductPageCandidate,
} from "./types"

function errorMessage(error: unknown) {
  if (!(error instanceof Error)) {
    return String(error)
  }

  const cause = "cause" in error ? (error as Error & { cause?: unknown }).cause : undefined

  if (cause instanceof Error && cause.message) {
    return `${error.message}: ${cause.message}`
  }

  if (cause && typeof cause === "object" && "code" in cause) {
    return `${error.message}: ${(cause as { code: string }).code}`
  }

  return error.message
}

export async function fetchProductHtml(url: string, timeoutMs = 12_000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; MedMKP-CatalogIndexer/0.1; +https://medmkp.local)",
        Accept: "text/html,application/xhtml+xml",
      },
    })
    const contentType = response.headers.get("content-type") ?? ""
    const body = await response.text()

    return {
      ok: response.ok && /html/i.test(contentType),
      status: String(response.status),
      html: body,
      error: response.ok ? `Non-HTML content type: ${contentType}` : response.statusText,
    }
  } finally {
    clearTimeout(timer)
  }
}

function failedExtraction(
  candidate: ProductPageCandidate,
  status: string,
  error: string
): FailedProductExtraction {
  return {
    distributor: candidate.distributor,
    url: candidate.url,
    status,
    error,
    sitemap_url: candidate.sitemap_url,
    confidence_score: candidate.confidence_score,
    reasons: candidate.reasons,
  }
}

function invalidProductReason(product: ProductExtractionResult["products"][number]) {
  const name = product.name?.trim() ?? ""
  const description = product.description?.trim() ?? ""
  const hasIdentifier = Boolean(product.sku?.trim() || product.manufacturer_sku?.trim())
  const hasPrice = Boolean(product.price?.trim() || product.price_cents)

  if (!name) {
    return "No product name extracted"
  }

  if (/page (?:has been )?removed|product not found|error code/i.test(`${name} ${description}`)) {
    return "Rejected supplier error/product-not-found page"
  }

  if (!hasIdentifier) {
    return "Rejected product row without supplier SKU or manufacturer SKU"
  }

  if (!hasPrice) {
    return "Rejected product row without price"
  }

  return ""
}

function debugLog(enabled: boolean | undefined, ...args: unknown[]) {
  if (enabled) {
    console.log("[product-extraction]", ...args)
  }
}

async function promiseMap<T, R>(
  items: T[],
  concurrency: number,
  iterator: (item: T, index: number) => Promise<R>
) {
  const results = new Array<R>(items.length)
  let nextIndex = 0

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (nextIndex < items.length) {
        const currentIndex = nextIndex++
        results[currentIndex] = await iterator(items[currentIndex], currentIndex)
      }
    })
  )

  return results
}

export async function extractProductPages(
  candidates: ProductPageCandidate[],
  options: { limit?: number; timeoutMs?: number; concurrency?: number; debug?: boolean } = {}
): Promise<ProductExtractionResult> {
  const selected = candidates.slice(0, options.limit ?? candidates.length)
  const products: ProductExtractionResult["products"] = []
  const failures: ProductExtractionResult["failures"] = []

  debugLog(
    options.debug,
    `Extracting ${selected.length} candidate(s) with timeout ${options.timeoutMs ?? "default"}`
  )

  const results = await promiseMap(
    selected,
    options.concurrency ?? 6,
    async (candidate, index) => {
      const position = `${index + 1}/${selected.length}`
      debugLog(options.debug, `Processing candidate ${position}: ${candidate.url}`)

      try {
        const result = await fetchProductHtml(candidate.url, options.timeoutMs)
        debugLog(
          options.debug,
          `Fetched ${candidate.url}: ok=${result.ok} status=${result.status} htmlLength=${result.html.length}`
        )

        if (!result.ok) {
          const failure = failedExtraction(candidate, result.status, result.error)
          debugLog(options.debug, `Candidate ${position} failed: ${result.error}`)
          return { products: [], failures: [failure] }
        }

        const adapter = adapterForCandidate(candidate)
        const extractedProducts = adapter.extractProducts
          ? adapter.extractProducts(candidate, result.html)
          : [adapter.extractProduct(candidate, result.html)]

        if (!extractedProducts.length) {
          const failure = failedExtraction(candidate, result.status, "No valid product rows extracted")
          debugLog(options.debug, `Candidate ${position} failed: no products extracted`)
          return { products: [], failures: [failure] }
        }

        const itemResults = {
          products: [] as ProductExtractionResult["products"],
          failures: [] as ProductExtractionResult["failures"],
        }

        for (const product of extractedProducts) {
          const reason = invalidProductReason(product)

          if (reason) {
            itemResults.failures.push(failedExtraction(candidate, result.status, reason))
            debugLog(options.debug, `Candidate ${position} rejected: ${reason}`)
            continue
          }

          itemResults.products.push(product)
          debugLog(
            options.debug,
            `Candidate ${position} succeeded: extracted product sku=${product.sku ?? product.manufacturer_sku} name=${product.name}`
          )
        }

        return itemResults
      } catch (error) {
        const failureReason = errorMessage(error)
        debugLog(options.debug, `Candidate ${position} exception: ${failureReason}`)
        return {
          products: [],
          failures: [failedExtraction(candidate, "fetch failed", failureReason)],
        }
      }
    }
  )

  for (const result of results) {
    products.push(...result.products)
    failures.push(...result.failures)
  }

  debugLog(
    options.debug,
    `Finished extract stage: ${products.length} products, ${failures.length} failures`
  )

  return {
    products,
    failures,
  }
}
