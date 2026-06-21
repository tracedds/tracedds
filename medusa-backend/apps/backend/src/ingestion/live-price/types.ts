/**
 * Per-user live pricing for no-price (identity-only) suppliers.
 *
 * Suppliers like Patterson and Henry Schein gate their prices behind a customer
 * login, so our bulk ingest stores identity only (name/MPN/brand/pack) and never
 * a price. Per policy we never bulk-ingest account pricing. Instead, when a user
 * who has linked THEIR OWN supplier credentials views a product that has an
 * offer from such a supplier, we fetch THEIR live price server-side at view time
 * and show it to that user only — never persisted, never in the shared price
 * comparison.
 *
 * A LivePriceProvider is the per-supplier seam: given the supplier's product
 * page HTML (fetched through an authenticated session by the headless agent
 * runner that owns login + the credential vault), it parses out the unit price.
 * The authenticated fetch is injected so this layer stays creds-agnostic and
 * unit-testable; only the parsing — our best assumption about WHERE the price
 * lives once logged in — lives here.
 */

export type LivePriceProvider = {
  supplier_id: string
  // Build a product page URL from the supplier SKU, when it's derivable (e.g.
  // Patterson's /Supplies/ItemDetail/{sku}). Optional: callers can also pass the
  // product_url stored on the supplier_product row.
  productUrl?: (sku: string) => string
  // Parse the AUTHENTICATED page HTML → unit price in cents, or null if no price
  // is present (e.g. still logged out, or the field shape changed).
  parsePriceCents: (html: string) => number | null
}

export type LivePriceResult = {
  supplier_id: string
  price_cents: number | null
  // Where this came from, for logging/UI ("Live price from your Patterson
  // account"). Never a shared/persisted price.
  source: "authenticated-live"
  fetched_at: string
}
