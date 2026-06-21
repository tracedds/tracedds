import { decodeHtmlEntities } from "../supplier-pipeline/html"
import type { LivePriceProvider } from "./types"

/**
 * Patterson live-price parser.
 *
 * BEST-GUESS ASSUMPTION (not yet verified against a real logged-in session):
 * the authenticated /Supplies/ItemDetail/{sku} page ships the SAME embedded item
 * model we already parse for identity, except `UnitPrice` is now populated
 * instead of null. Logged out we observed:
 *   …&quot;UnitPrice&quot;:null,&quot;UnitPriceOverride&quot;:null…
 * so logged in we expect a number (the account's contract price), e.g.
 *   …"UnitPrice":12.34… (dollars) and possibly a non-null "UnitPriceOverride".
 *
 * We read UnitPriceOverride first (a per-account override seen in the model),
 * then UnitPrice. Values may be a bare JSON number or a quoted/$-prefixed
 * string, so we normalize both. If neither is a positive number (still gated,
 * or the shape changed once we see real authed HTML) we return null and the
 * caller shows nothing rather than a wrong price.
 */

function priceFieldCents(decoded: string, key: string): number | null {
  // number form:  "UnitPrice":12.34
  // string form:  "UnitPrice":"$12.34"  /  "UnitPrice":"12.34"
  const match = decoded.match(
    new RegExp(`"${key}"\\s*:\\s*(?:"\\s*\\$?\\s*([0-9][0-9,]*\\.?[0-9]*)\\s*"|([0-9][0-9,]*\\.?[0-9]*))`)
  )
  if (!match) return null
  const raw = (match[1] ?? match[2] ?? "").replace(/,/g, "")
  if (!raw) return null
  const dollars = Number(raw)
  if (!Number.isFinite(dollars) || dollars <= 0) return null
  return Math.round(dollars * 100)
}

export function parsePattersonAuthedPriceCents(html: string): number | null {
  const decoded = decodeHtmlEntities(html)
  return (
    priceFieldCents(decoded, "UnitPriceOverride") ??
    priceFieldCents(decoded, "UnitPrice")
  )
}

export const pattersonLivePriceProvider: LivePriceProvider = {
  supplier_id: "msup_pattersondental_com",
  productUrl: (sku) =>
    `https://www.pattersondental.com/Supplies/ItemDetail/${sku}`,
  parsePriceCents: parsePattersonAuthedPriceCents,
}
