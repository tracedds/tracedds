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

function decodeBasicHtml(value: string) {
  return value.replace(/&amp;/g, "&").replace(/&quot;/g, "\"")
}

function dcDentalApiUrl(productUrl: string, html: string) {
  try {
    if (!/dcdental\.com$/i.test(new URL(productUrl).hostname)) {
      return ""
    }
  } catch {
    return ""
  }

  const match = html.match(/<img[^>]+src="([^"]*\/api\/items\?[^"]*)"[^>]*>/i)
  const source = match?.[1]

  if (!source) {
    return ""
  }

  try {
    return new URL(decodeBasicHtml(source), productUrl).href
  } catch {
    return ""
  }
}

async function fetchDcDentalApiJson(productUrl: string, html: string, timeoutMs: number) {
  const apiUrl = dcDentalApiUrl(productUrl, html)

  if (!apiUrl) {
    return ""
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(apiUrl, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; MedMKP-CatalogIndexer/0.1; +https://medmkp.local)",
        Accept: "application/json",
      },
    })

    if (!response.ok) {
      return ""
    }

    return await response.text()
  } catch {
    return ""
  } finally {
    clearTimeout(timer)
  }
}

function appendDcDentalApiJson(html: string, json: string) {
  if (!json.trim()) {
    return html
  }

  return html + "\n<script type=\"application/json\" id=\"medmkp-dcdental-api\">" +
    json.replace(/<\//g, "<\\/") +
    "</script>"
}

function shopifyProductJsonUrl(productUrl: string) {
  try {
    const url = new URL(productUrl)

    if (!/(^|\.)amerdental\.com$/i.test(url.hostname) &&
      !/(^|\.)carolinadental\.com$/i.test(url.hostname)) {
      return ""
    }

    if (!/^\/products\/[^/]+\/?$/i.test(url.pathname)) {
      return ""
    }

    url.hostname = `www.${url.hostname.replace(/^www\./i, "")}`
    url.pathname = url.pathname.replace(/\/$/i, "") + ".js"
    url.search = ""
    url.hash = ""

    return url.href
  } catch {
    return ""
  }
}

async function fetchShopifyProductJson(productUrl: string, timeoutMs: number) {
  const jsonUrl = shopifyProductJsonUrl(productUrl)

  if (!jsonUrl) {
    return ""
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(jsonUrl, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; MedMKP-CatalogIndexer/0.1; +https://medmkp.local)",
        Accept: "application/json",
      },
    })

    if (!response.ok) {
      return ""
    }

    const contentType = response.headers.get("content-type") ?? ""

    if (!/json|javascript/i.test(contentType)) {
      return ""
    }

    return await response.text()
  } catch {
    return ""
  } finally {
    clearTimeout(timer)
  }
}

function appendShopifyProductJson(html: string, json: string) {
  if (!json.trim()) {
    return html
  }

  return html + "\n<script type=\"application/json\" id=\"medmkp-shopify-product-json\">" +
    json.replace(/<\//g, "<\\/") +
    "</script>"
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
    const dcDentalApiJson = await fetchDcDentalApiJson(url, body, timeoutMs)
    const shopifyProductJson = await fetchShopifyProductJson(url, timeoutMs)
    const html = appendShopifyProductJson(
      appendDcDentalApiJson(body, dcDentalApiJson),
      shopifyProductJson
    )

    return {
      ok: response.ok && /html/i.test(contentType),
      status: String(response.status),
      html,
      error: response.ok ? `Non-HTML content type: ${contentType}` : response.statusText,
    }
  } finally {
    clearTimeout(timer)
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function fetchProductHtmlWithRetries(
  url: string,
  timeoutMs: number | undefined,
  attempts = 3
) {
  let lastResult: Awaited<ReturnType<typeof fetchProductHtml>> | undefined
  let lastError: unknown

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const result = await fetchProductHtml(url, timeoutMs)
      lastResult = result

      if (result.ok) {
        return result
      }
    } catch (error) {
      lastError = error
    }

    if (attempt < attempts) {
      await sleep(500 * attempt)
    }
  }

  if (lastResult) {
    return lastResult
  }

  throw lastError
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

function infoLog(...args: unknown[]) {
  console.log("[product-extraction]", ...args)
}

function formatEta(seconds: number) {
  if (seconds >= 90) {
    return `${Math.round(seconds / 60)}m`
  }

  return `${seconds}s`
}

const PROGRESS_LOG_INTERVAL = 100

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

  infoLog(
    `Extracting ${selected.length} candidate(s) with timeout ${options.timeoutMs ?? "default"} and concurrency ${options.concurrency ?? 6}`
  )

  const startedAt = Date.now()
  let completed = 0
  let extractedCount = 0
  let failureCount = 0

  const trackProgress = (outcome: {
    products: ProductExtractionResult["products"]
    failures: ProductExtractionResult["failures"]
  }) => {
    completed += 1
    extractedCount += outcome.products.length
    failureCount += outcome.failures.length

    if (completed % PROGRESS_LOG_INTERVAL === 0 || completed === selected.length) {
      const elapsedSeconds = Math.max((Date.now() - startedAt) / 1000, 1)
      const rate = completed / elapsedSeconds
      const etaSeconds = Math.round((selected.length - completed) / Math.max(rate, 0.01))
      infoLog(
        `progress ${completed}/${selected.length} products=${extractedCount} failures=${failureCount} rate=${rate.toFixed(2)}/s eta=${formatEta(etaSeconds)}`
      )
    }

    return outcome
  }

  const results = await promiseMap(
    selected,
    options.concurrency ?? 6,
    async (candidate, index) => {
      const position = `${index + 1}/${selected.length}`
      debugLog(options.debug, `Processing candidate ${position}: ${candidate.url}`)

      try {
        const result = await fetchProductHtmlWithRetries(candidate.url, options.timeoutMs)
        debugLog(
          options.debug,
          `Fetched ${candidate.url}: ok=${result.ok} status=${result.status} htmlLength=${result.html.length}`
        )

        if (!result.ok) {
          const failure = failedExtraction(candidate, result.status, result.error)
          debugLog(options.debug, `Candidate ${position} failed: ${result.error}`)
          return trackProgress({ products: [], failures: [failure] })
        }

        const adapter = adapterForCandidate(candidate)
        const extractedProducts = adapter.extractProducts
          ? adapter.extractProducts(candidate, result.html)
          : [adapter.extractProduct(candidate, result.html)]

        if (!extractedProducts.length) {
          const failure = failedExtraction(candidate, result.status, "No valid product rows extracted")
          debugLog(options.debug, `Candidate ${position} failed: no products extracted`)
          return trackProgress({ products: [], failures: [failure] })
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

        return trackProgress(itemResults)
      } catch (error) {
        const failureReason = errorMessage(error)
        debugLog(options.debug, `Candidate ${position} exception: ${failureReason}`)
        return trackProgress({
          products: [],
          failures: [failedExtraction(candidate, "fetch failed", failureReason)],
        })
      }
    }
  )

  for (const result of results) {
    products.push(...result.products)
    failures.push(...result.failures)
  }

  infoLog(
    `Finished extract stage: ${products.length} products, ${failures.length} failures`
  )

  return {
    products,
    failures,
  }
}
