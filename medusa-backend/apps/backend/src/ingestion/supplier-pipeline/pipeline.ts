import { resolve } from "path"
import { discoverSupplierSitemaps } from "./sitemap-discovery"
import { discoverSupplierSourceUrls } from "./source-url-discovery"
import { extractProductPages } from "./product-extraction"
import { filterSuppliers, supplierRowsFromCsv } from "./suppliers"
import { indexSupplierSitemapUrls, summarizeIndexedUrls } from "./url-index"
import { writePipelineDebugOutput } from "./debug-output"
import type {
  IndexedSupplierUrl,
  ProductPageCandidate,
  SupplierSeedRow,
  SupplierSitemapSummary,
  SupplierSourceUrl,
  SupplierSourceUrlSummary,
} from "./types"

export type SupplierIngestionStage = "discover" | "index" | "extract"

export type SupplierIngestionPipelineOptions = {
  suppliersCsvPath?: string
  suppliers?: SupplierSeedRow[]
  supplierName?: string
  stages?: SupplierIngestionStage[]
  productLimit?: number
  timeoutMs?: number
  sitemapConcurrency?: number
  productConcurrency?: number
  sourceUrls?: SupplierSourceUrl[]
  sourceConcurrency?: number
  maxLinksPerSource?: number
  debug?: boolean
  debugOutputDir?: string
}

function productCandidates(indexedUrls: IndexedSupplierUrl[]) {
  const seen = new Set<string>()

  return indexedUrls
    .filter((row): row is ProductPageCandidate => row.url_type === "product")
    .filter((row) => {
      if (seen.has(row.url)) {
        return false
      }

      seen.add(row.url)
      return true
    })
    .sort((a, b) => b.confidence_score - a.confidence_score)
}

function log(debug: boolean | undefined, ...args: unknown[]) {
  if (debug) {
    console.log("[supplier-ingestion]", ...args)
  }
}

export async function runSupplierIngestionPipeline(
  options: SupplierIngestionPipelineOptions
) {
  const stages = options.stages ?? ["discover", "index", "extract"]
  const sourceSuppliers = options.suppliers ??
    supplierRowsFromCsv(resolve(options.suppliersCsvPath ?? "../../../research/dental-suppliers.csv"))
  const suppliers = filterSuppliers(
    sourceSuppliers,
    options.supplierName
  )

  log(options.debug, "Starting supplier ingestion pipeline")
  log(options.debug, "Stages:", stages.join(", "))
  log(options.debug, "Suppliers:", suppliers.map((supplier) => supplier.distributor).join(", "))

  if (!suppliers.length) {
    throw new Error(
      options.supplierName
        ? `No supplier matched "${options.supplierName}"`
        : "No suppliers found"
    )
  }

  let sitemaps: SupplierSitemapSummary[] = []
  let sourceUrlSummaries: SupplierSourceUrlSummary[] = []
  let indexedUrls: IndexedSupplierUrl[] = []
  let extracted = {
    products: [],
    failures: [],
  } as Awaited<ReturnType<typeof extractProductPages>>

  if (stages.includes("discover")) {
    log(options.debug, "Beginning discovery stage")
    sitemaps = await discoverSupplierSitemaps(suppliers, {
      timeoutMs: options.timeoutMs,
      debug: options.debug,
      concurrency: options.sitemapConcurrency,
      sitemapConcurrency: options.sitemapConcurrency,
    })
    log(
      options.debug,
      `Discovery stage complete: ${sitemaps.length} suppliers processed, ${sitemaps.reduce(
        (total, supplier) => total + supplier.sitemaps.length,
        0
      )} sitemap fetches attempted`
    )
  }

  if (stages.includes("index")) {
    log(options.debug, "Beginning index stage")
    indexedUrls = indexSupplierSitemapUrls(sitemaps)
    if (options.sourceUrls?.length) {
      log(
        options.debug,
        `Index stage source URL discovery: ${options.sourceUrls.length} source URL(s)`
      )
      const sourceResults = await discoverSupplierSourceUrls(options.sourceUrls, {
        timeoutMs: options.timeoutMs,
        debug: options.debug,
        concurrency: options.sourceConcurrency,
        maxLinksPerSource: options.maxLinksPerSource,
      })
      sourceUrlSummaries = sourceResults.summaries
      indexedUrls.push(...sourceResults.indexedUrls)
    }
    const indexedSummary = summarizeIndexedUrls(indexedUrls)
    log(
      options.debug,
      `Index stage complete: ${indexedSummary.indexed_urls} urls parsed, ${indexedSummary.product_candidates} product candidates, ${indexedSummary.category_candidates} category candidates`
    )
  }

  if (stages.includes("extract")) {
    const candidates = productCandidates(indexedUrls)
    log(
      options.debug,
      `Beginning extract stage: ${candidates.length} product candidate(s) to process`,
      options.productLimit ? `(limit ${options.productLimit})` : ""
    )
    extracted = await extractProductPages(candidates, {
      limit: options.productLimit,
      timeoutMs: options.timeoutMs,
      concurrency: options.productConcurrency,
      debug: options.debug,
    })
    log(
      options.debug,
      `Extract stage complete: ${extracted.products.length} products extracted, ${extracted.failures.length} failures`
    )
  }

  const indexedSummary = summarizeIndexedUrls(indexedUrls)
  const summary = {
    suppliers: suppliers.length,
    stages,
    sitemap_downloads: sitemaps.reduce(
      (total, supplier) => total + supplier.sitemaps.length,
      0
    ),
    successful_sitemap_downloads: sitemaps.reduce(
      (total, supplier) =>
        total + supplier.sitemaps.filter((sitemap) => sitemap.ok).length,
      0
    ),
    source_pages: sourceUrlSummaries.length,
    successful_source_pages: sourceUrlSummaries.filter((source) => source.page.ok).length,
    source_discovered_urls: sourceUrlSummaries.reduce(
      (total, source) => total + source.discovered_urls,
      0
    ),
    ...indexedSummary,
    extracted_products: extracted.products.length,
    extraction_failures: extracted.failures.length,
  }
  const debugOutputDir = options.debug
    ? writePipelineDebugOutput(
        options.debugOutputDir ?? "./.medmkp/ingestion/latest",
        {
          summary,
          sitemaps,
          sourceUrlSummaries,
          indexedUrls,
          products: extracted.products,
          failures: extracted.failures,
        }
      )
    : undefined

  log(options.debug, "Pipeline finished", summary)

  return {
    summary: {
      ...summary,
      debug_output_dir: debugOutputDir,
    },
    sitemaps,
    sourceUrlSummaries,
    indexedUrls,
    products: extracted.products,
    failures: extracted.failures,
  }
}
