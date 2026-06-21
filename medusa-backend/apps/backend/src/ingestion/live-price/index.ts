import { pattersonLivePriceProvider } from "./patterson"
import { henryScheinLivePriceProvider } from "./henryschein"
import type { LivePriceProvider, LivePriceResult } from "./types"

export type { LivePriceProvider, LivePriceResult } from "./types"
export { parsePattersonAuthedPriceCents } from "./patterson"
export { parseHenryScheinAuthedPriceCents } from "./henryschein"

const PROVIDERS: LivePriceProvider[] = [
  pattersonLivePriceProvider,
  henryScheinLivePriceProvider,
]

const BY_SUPPLIER = new Map(PROVIDERS.map((p) => [p.supplier_id, p]))

export function livePriceProviderFor(supplierId: string): LivePriceProvider | undefined {
  return BY_SUPPLIER.get(supplierId)
}

// True for the identity-only suppliers whose price we can only get per-user,
// live, through their own login.
export function supportsLivePrice(supplierId: string): boolean {
  return BY_SUPPLIER.has(supplierId)
}

/**
 * Fetch one user's live price for a supplier product. `authedFetch` performs the
 * request through that user's authenticated session — it's owned by the headless
 * agent runner (which holds the credential vault + login), so this stays
 * creds-agnostic and testable. The result is per-user and ephemeral: callers
 * must never persist it as a shared price snapshot or feed it into the public
 * price comparison.
 */
export async function fetchLivePriceCents(opts: {
  supplier_id: string
  // The supplier_product.product_url; falls back to the provider's URL builder.
  url?: string
  sku?: string
  authedFetch: (url: string) => Promise<string>
}): Promise<LivePriceResult> {
  const provider = BY_SUPPLIER.get(opts.supplier_id)
  const now = new Date().toISOString()
  if (!provider) {
    return { supplier_id: opts.supplier_id, price_cents: null, source: "authenticated-live", fetched_at: now }
  }

  const url = opts.url || (opts.sku && provider.productUrl ? provider.productUrl(opts.sku) : undefined)
  if (!url) {
    return { supplier_id: opts.supplier_id, price_cents: null, source: "authenticated-live", fetched_at: now }
  }

  let price_cents: number | null = null
  try {
    const html = await opts.authedFetch(url)
    price_cents = html ? provider.parsePriceCents(html) : null
  } catch {
    price_cents = null
  }

  return { supplier_id: opts.supplier_id, price_cents, source: "authenticated-live", fetched_at: now }
}
