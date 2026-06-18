import type { MedusaContainer } from "@medusajs/framework"
import { MARKETPLACE_PROVIDERS } from "../ingestion/marketplace/providers"
import { MEDMKP_MODULE } from "../modules/medmkp"
import type MedMKPModuleService from "../modules/medmkp/service"

// Read-only snapshot of what each marketplace pipeline has persisted. Use to
// monitor an ingest's progress / outcome:
//   npm run marketplace:status
//   npm run marketplace:status -- --provider=amazon
function selectedProviders() {
  const arg = process.argv
    .slice(2)
    .find((value) => value.startsWith("--provider="))
  const requested = (arg?.split("=")[1] ?? process.env.MARKETPLACE_PROVIDER ?? "")
    .trim()
    .toLowerCase()
  if (requested) {
    return Object.values(MARKETPLACE_PROVIDERS).filter((p) => p.id === requested)
  }
  return Object.values(MARKETPLACE_PROVIDERS)
}

export default async function marketplaceCatalogStatus({
  container,
}: {
  container: MedusaContainer
}) {
  const medmkp = container.resolve<MedMKPModuleService>(MEDMKP_MODULE)
  const report: Record<string, unknown>[] = []

  for (const provider of selectedProviders()) {
    const supplierId = `msup_${provider.id}`
    const sourceCatalog = `${provider.id}-marketplace-search`

    const [suppliers, products, sources] = await Promise.all([
      medmkp.listSuppliers({ id: supplierId }),
      medmkp.listSupplierProducts({ supplier_id: supplierId, source_catalog: sourceCatalog }),
      medmkp.listSupplierCatalogSources({ supplier_id: supplierId, source_catalog: sourceCatalog }),
    ])

    const productIds = products.map((product) => product.id)
    const [matches, snapshots] = await Promise.all([
      productIds.length
        ? medmkp.listCanonicalProductMatches({ supplier_product_id: productIds })
        : Promise.resolve([]),
      medmkp.listSupplierPriceSnapshots({ supplier_id: supplierId }),
    ])

    const matchStatus = matches.reduce<Record<string, number>>((acc, match) => {
      acc[match.match_status] = (acc[match.match_status] ?? 0) + 1
      return acc
    }, {})
    const lastCrawledAt = sources
      .map((source) => source.last_crawled_at)
      .sort()
      .at(-1)

    report.push({
      provider: provider.id,
      supplier_provisioned: suppliers.length > 0,
      products: products.length,
      products_with_image: products.filter((product) => product.image_url).length,
      distinct_canonical_products_matched: new Set(
        matches.map((match) => match.canonical_product_id)
      ).size,
      canonical_matches: matches.length,
      match_status: matchStatus,
      price_snapshots: snapshots.length,
      last_crawled_at: lastCrawledAt ?? null,
    })
  }

  console.log(JSON.stringify({ marketplace_status: report }, null, 2))
}
