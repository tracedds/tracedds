import { jsonLdBlocks, flattenJsonLd, stringValue } from "../supplier-pipeline/html"
import type { LivePriceProvider } from "./types"

/**
 * Henry Schein live-price parser.
 *
 * BEST-GUESS ASSUMPTION (not yet verified against a real logged-in session):
 * the authenticated HS product page ships the same `application/ld+json` Product
 * block we already parse for identity, but `offers.price` is the account's real
 * price instead of the logged-out "0.00". So we read offers.price and treat
 * anything > 0 as the live price. (HS also has a public Web Priced Products
 * campaign — handled separately in the adapter — but that's a bounded public
 * subset, not the per-account price this path is for.)
 *
 * If no positive price is present (still gated, or the shape changed once we see
 * real authed HTML) we return null so the caller shows nothing.
 */

function offerPriceCents(product: Record<string, unknown>): number | null {
  const offers = product.offers
  const offerList = Array.isArray(offers) ? offers : offers ? [offers] : []
  for (const offer of offerList) {
    if (!offer || typeof offer !== "object") continue
    const raw = stringValue((offer as Record<string, unknown>).price).replace(/[$,\s]/g, "")
    if (!raw) continue
    const dollars = Number(raw)
    if (Number.isFinite(dollars) && dollars > 0) return Math.round(dollars * 100)
  }
  return null
}

export function parseHenryScheinAuthedPriceCents(html: string): number | null {
  const products = jsonLdBlocks(html)
    .flatMap(flattenJsonLd)
    .filter((record) => {
      const type = record["@type"]
      return Array.isArray(type)
        ? type.some((t) => String(t).toLowerCase() === "product")
        : String(type).toLowerCase() === "product"
    })

  for (const product of products) {
    const cents = offerPriceCents(product)
    if (cents !== null) return cents
  }
  return null
}

export const henryScheinLivePriceProvider: LivePriceProvider = {
  supplier_id: "msup_henryschein_com",
  parsePriceCents: parseHenryScheinAuthedPriceCents,
}
