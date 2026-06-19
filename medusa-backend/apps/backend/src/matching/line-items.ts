import type { Pool } from "pg"
import { normalizeProduct, normalizeSku } from "./normalize"
import { compareNumericAttrs, jaccard, scorePair, trigramDice } from "./score"
import type { NormalizedProduct, SupplierProductRow } from "./types"

/**
 * Invoice line item matching (see PRODUCT_MATCHING.md "Line Item Matching").
 *
 * A line item is treated as a supplier product with worse data: a raw
 * description, usually a SKU, plus quantity and prices. Matching reuses the
 * supplier-to-supplier evidence model (normalize.ts / score.ts) in three
 * tiers:
 *
 *   1. Supplier SKU resolution — the invoice vendor is one of our ingested
 *      suppliers and the SKU matches that supplier's own catalog.
 *   2. Catalog-code blocking + scorePair — same fuzzy path the product
 *      matcher uses (manufacturer SKUs, name-embedded catalog numbers).
 *   3. Name similarity — for SKU-less items, the best same-type product
 *      becomes a review-grade suggestion, never an assertion.
 *
 * Candidate retrieval is done with indexed SQL against the blocking read-model
 * (medmkp_supplier_product_match_index, populated by match-index.ts) so a match
 * request only loads the handful of products that share a SKU / code / token
 * with each line — never the whole catalog. Scoring still runs in JS, unchanged.
 */

export type LineItemInput = {
  description: string
  sku?: string
  brand?: string
  qty?: number
  unit?: string
  unit_price_cents?: number | null
  pack_size?: string
}

export type OfferView = {
  supplier_product_id: string
  supplier_id: string
  supplier_name: string
  sku: string
  name: string
  brand: string
  price_cents: number
  /** price_cents normalized to the invoice item's pack quantity when both are known */
  comparable_price_cents: number
  /** price_cents / pack_quantity — what one item in the pack costs, when parseable */
  unit_price_cents: number | null
  /** units per pack when parseable from pack_size / name */
  pack_quantity: number | null
  pack_size: string
  product_url: string
  image_url: string
  /** Latest snapshot's stock signal: in_stock | limited | backordered | unknown. */
  availability: string
}

export type LineItemMatch = {
  input: LineItemInput
  match_status: "exact" | "variant" | "needs_review" | "unmatched"
  confidence: number
  match_reason: string
  matched_supplier_product: {
    id: string
    supplier_id: string
    supplier_name: string
    sku: string
    name: string
    image_url: string
  } | null
  canonical_product: { id: string; name: string; category: string } | null
  display_image_url: string
  offers: OfferView[]
  best_offer: OfferView | null
  savings_cents: number
}

export type InvoiceMatchResult = {
  vendor_supplier_id: string | null
  catalog_products: number
  line_items: LineItemMatch[]
}

const MIN_SHARED_CORE_TOKENS = 2
const NAME_ONLY_MIN_SIM = 0.55

type MatchContext = {
  pool: Pool
  supplierNameById: Map<string, string>
}

/** Product columns selected for candidate scoring / offer building. */
type ProductColumns = {
  id: string
  supplier_id: string
  sku: string
  manufacturer_sku: string
  brand: string
  name: string
  category: string
  pack_size: string
  unit_of_measure: string
  product_url: string
  image_url: string
}

function toRow(
  cols: ProductColumns,
  priceCents: number | null,
  availability: string | null = null
): SupplierProductRow {
  return { ...cols, price_cents: priceCents, price_basis: null, availability }
}

/** Resolve an invoice vendor name to an ingested supplier id, if any. */
export function resolveVendorSupplier(
  suppliers: { id: string; name: string }[],
  vendorName?: string
): string | null {
  if (!vendorName) {
    return null
  }
  const vendorTokens = new Set(vendorName.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean))
  let best: string | null = null
  let bestSim = 0
  for (const supplier of suppliers) {
    const tokens = supplier.name.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
    const sim = jaccard(vendorTokens, tokens)
    if (sim > bestSim) {
      bestSim = sim
      best = supplier.id
    }
  }
  return bestSim >= 0.5 ? best : null
}

function toPseudoProduct(input: LineItemInput): NormalizedProduct {
  const row: SupplierProductRow = {
    id: "_invoice_line",
    supplier_id: "_invoice",
    sku: input.sku ?? "",
    manufacturer_sku: input.sku ?? "",
    brand: input.brand ?? "",
    name: input.description,
    category: "",
    pack_size: input.pack_size ?? "",
    unit_of_measure: input.unit ?? "",
    product_url: "",
    image_url: "",
    price_cents: input.unit_price_cents ?? null,
    price_basis: null,
  }
  return normalizeProduct(row)
}

/** Same blend scorePair uses, for candidates with no SKU evidence. */
function nameOnlySimilarity(item: NormalizedProduct, candidate: NormalizedProduct): number {
  const numeric = compareNumericAttrs(item, candidate)
  if (numeric.hardConflict) {
    return 0
  }
  let sim =
    0.45 * jaccard(item.nameTokens, candidate.nameTokens) + 0.55 * trigramDice(item, candidate)
  sim += Math.min(numeric.agreements * 0.05, 0.15)
  if (numeric.bareConflict) {
    sim -= 0.1
  }
  return Math.max(0, Math.min(1, sim))
}

function comparablePrice(item: NormalizedProduct, offer: NormalizedProduct): number {
  if (
    item.packQty !== null &&
    offer.packQty !== null &&
    offer.packQty !== item.packQty &&
    offer.unitPriceCents !== null
  ) {
    return Math.round(offer.unitPriceCents * item.packQty)
  }
  return offer.row.price_cents ?? 0
}

type Candidate = {
  row: SupplierProductRow
  /** stored (DF-capped) core tokens, used for the Tier-3 shared-token count */
  storedCoreTokens: string[]
  t1: boolean
  t2: boolean
  t3: boolean
}

const CANDIDATE_SELECT =
  `p.id, p.supplier_id, p.sku, p.manufacturer_sku, p.brand, p.name, p.category, ` +
  `p.pack_size, p.unit_of_measure, p.product_url, p.image_url, mi.core_tokens`

/**
 * Retrieve the products that share a blocking key with this line item. One
 * indexed query returns the union of the requested tiers, each row tagged with
 * which tier(s) it satisfies so the caller can apply the tier logic.
 *
 * `tiers` selects which blocking keys to query. Tier 1/2 (SKU + catalog code)
 * are cheap indexed lookups; Tier 3 (shared core name tokens) is a heavier GIN
 * scan, so the caller defers it until SKU/code matching has failed.
 */
async function fetchCandidates(
  ctx: MatchContext,
  item: NormalizedProduct,
  skuKey: string,
  vendorSupplierId: string | null,
  tiers: { t1?: boolean; t2?: boolean; t3?: boolean }
): Promise<Candidate[]> {
  const params: unknown[] = []
  const param = (value: unknown) => {
    params.push(value)
    return `$${params.length}`
  }

  const t1Clauses: string[] = []
  const t2Clauses: string[] = []
  const t3Clauses: string[] = []

  // Tier 1: the vendor's own SKU.
  if (tiers.t1 && vendorSupplierId && skuKey.length >= 3) {
    t1Clauses.push(`(mi.supplier_id = ${param(vendorSupplierId)} AND mi.norm_sku = ${param(skuKey)})`)
  }
  // Tier 2: manufacturer SKU + name-embedded catalog codes.
  if (tiers.t2) {
    if (item.mfrSku.length >= 4) {
      t2Clauses.push(`mi.norm_mfr_sku = ${param(item.mfrSku)}`)
    }
    const codeKeys = [item.mfrSku, ...item.skuLikeTokens].filter((key) => key.length >= 4)
    if (codeKeys.length) {
      t2Clauses.push(`mi.code_tokens && ${param(codeKeys)}::text[]`)
    }
  }
  // Tier 3: shared core name tokens (the read-model already dropped tokens that
  // are too common to block on, so this never pulls runaway candidate sets).
  if (tiers.t3) {
    const coreTokens = [...new Set(item.coreTokens)]
    if (coreTokens.length) {
      t3Clauses.push(`mi.core_tokens && ${param(coreTokens)}::text[]`)
    }
  }

  const allClauses = [...t1Clauses, ...t2Clauses, ...t3Clauses]
  if (!allClauses.length) {
    return []
  }

  const flag = (clauses: string[]) => (clauses.length ? clauses.join(" OR ") : "false")
  const sql =
    `SELECT ${CANDIDATE_SELECT}, ` +
    `(${flag(t1Clauses)}) AS t1, (${flag(t2Clauses)}) AS t2, (${flag(t3Clauses)}) AS t3 ` +
    `FROM medmkp_supplier_product_match_index mi ` +
    `JOIN medmkp_supplier_product p ON p.id = mi.supplier_product_id AND p.deleted_at IS NULL ` +
    `WHERE ${allClauses.join(" OR ")}`

  const { rows } = await ctx.pool.query<
    ProductColumns & { core_tokens: string[] | null; t1: boolean; t2: boolean; t3: boolean }
  >(sql, params)

  return rows.map((row) => ({
    row: toRow(row, null),
    storedCoreTokens: row.core_tokens ?? [],
    t1: row.t1 === true,
    t2: row.t2 === true,
    t3: row.t3 === true,
  }))
}

/** Resolve a matched product's canonical group + its sibling member ids. */
async function loadCanonical(
  ctx: MatchContext,
  supplierProductId: string
): Promise<{ canonical: { id: string; name: string; category: string } | null; memberIds: string[] }> {
  const link = await ctx.pool.query<{ canonical_product_id: string }>(
    `SELECT canonical_product_id FROM medmkp_canonical_product_match
     WHERE supplier_product_id = $1 AND deleted_at IS NULL
       AND match_status IN ('exact', 'variant') AND canonical_product_id <> ''
     LIMIT 1`,
    [supplierProductId]
  )
  if (!link.rows.length) {
    return { canonical: null, memberIds: [supplierProductId] }
  }

  const canonicalProductId = link.rows[0].canonical_product_id
  const members = await ctx.pool.query<{ supplier_product_id: string }>(
    `SELECT supplier_product_id FROM medmkp_canonical_product_match
     WHERE canonical_product_id = $1 AND deleted_at IS NULL AND match_status IN ('exact', 'variant')`,
    [canonicalProductId]
  )
  const canon = await ctx.pool.query<{ id: string; name: string; category: string }>(
    `SELECT id, name, category FROM medmkp_canonical_product WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
    [canonicalProductId]
  )
  const memberIds = members.rows.map((row) => row.supplier_product_id)
  return {
    canonical: canon.rows[0] ?? null,
    memberIds: memberIds.length ? memberIds : [supplierProductId],
  }
}

/** Fetch product rows + their latest price for a small set of ids (offers). */
async function fetchOfferRows(ctx: MatchContext, ids: string[]): Promise<SupplierProductRow[]> {
  if (!ids.length) {
    return []
  }
  const { rows } = await ctx.pool.query<
    ProductColumns & { price_cents: number | null; availability: string | null }
  >(
    `SELECT p.id, p.supplier_id, p.sku, p.manufacturer_sku, p.brand, p.name, p.category,
            p.pack_size, p.unit_of_measure, p.product_url, p.image_url,
            price.price_cents, price.availability
     FROM medmkp_supplier_product p
     LEFT JOIN (
       SELECT DISTINCT ON (supplier_product_id) supplier_product_id, price_cents, availability
       FROM medmkp_supplier_price_snapshot
       WHERE deleted_at IS NULL AND supplier_product_id = ANY($1)
       ORDER BY supplier_product_id, captured_at DESC
     ) price ON price.supplier_product_id = p.id
     WHERE p.id = ANY($1) AND p.deleted_at IS NULL`,
    [ids]
  )
  return rows.map((row) => toRow(row, row.price_cents, row.availability))
}

export function buildOffers(
  ctx: MatchContext,
  item: NormalizedProduct,
  members: SupplierProductRow[]
): OfferView[] {
  const offers: OfferView[] = []
  for (const memberRow of members) {
    if (memberRow.price_cents === null || memberRow.price_cents <= 0) {
      continue
    }
    const product = normalizeProduct(memberRow)
    offers.push({
      supplier_product_id: memberRow.id,
      supplier_id: memberRow.supplier_id,
      supplier_name: ctx.supplierNameById.get(memberRow.supplier_id) ?? "Unknown supplier",
      sku: memberRow.sku,
      name: memberRow.name,
      brand: memberRow.brand,
      price_cents: memberRow.price_cents,
      comparable_price_cents: comparablePrice(item, product),
      unit_price_cents: product.packQty && product.packQty > 1 ? product.unitPriceCents : null,
      pack_quantity: product.packQty,
      pack_size: memberRow.pack_size,
      product_url: memberRow.product_url,
      image_url: memberRow.image_url,
      availability: memberRow.availability ?? "unknown",
    })
  }
  return offers.sort((a, b) => a.comparable_price_cents - b.comparable_price_cents)
}

async function finalize(
  ctx: MatchContext,
  input: LineItemInput,
  item: NormalizedProduct,
  matchedRow: SupplierProductRow,
  status: LineItemMatch["match_status"],
  confidence: number,
  reason: string
): Promise<LineItemMatch> {
  const { canonical, memberIds } = await loadCanonical(ctx, matchedRow.id)
  const members = await fetchOfferRows(ctx, memberIds)
  const offers = buildOffers(ctx, item, members)
  const bestOffer = offers[0] ?? null
  const displayImageUrl =
    bestOffer?.image_url ||
    offers.find((offer) => offer.image_url)?.image_url ||
    matchedRow.image_url ||
    ""

  const qty = input.qty ?? 1
  const invoicePrice = input.unit_price_cents ?? null
  const savings =
    bestOffer && invoicePrice !== null
      ? Math.max(0, (invoicePrice - bestOffer.comparable_price_cents) * qty)
      : 0

  return {
    input,
    match_status: status,
    confidence,
    match_reason: reason,
    matched_supplier_product: {
      id: matchedRow.id,
      supplier_id: matchedRow.supplier_id,
      supplier_name: ctx.supplierNameById.get(matchedRow.supplier_id) ?? "Unknown supplier",
      sku: matchedRow.sku,
      name: matchedRow.name,
      image_url: matchedRow.image_url,
    },
    canonical_product: canonical,
    display_image_url: displayImageUrl,
    offers: offers.slice(0, 5),
    best_offer: bestOffer,
    savings_cents: savings,
  }
}

function unmatched(input: LineItemInput, reason: string): LineItemMatch {
  return {
    input,
    match_status: "unmatched",
    confidence: 0,
    match_reason: reason,
    matched_supplier_product: null,
    canonical_product: null,
    display_image_url: "",
    offers: [],
    best_offer: null,
    savings_cents: 0,
  }
}

async function matchLineItem(
  ctx: MatchContext,
  input: LineItemInput,
  vendorSupplierId: string | null
): Promise<LineItemMatch> {
  const item = toPseudoProduct(input)
  const skuKey = normalizeSku(input.sku)

  // Phase 1: cheap SKU / catalog-code blocking (Tiers 1 & 2). The heavier
  // core-token scan (Tier 3) is deferred until these fail, so SKU-bearing
  // invoice lines — the common case — never pay for it.
  const skuCandidates = await fetchCandidates(ctx, item, skuKey, vendorSupplierId, { t1: true, t2: true })

  // Tier 1: the vendor is an ingested supplier and the SKU is theirs. The
  // supplier's own SKU is authoritative even when the invoice truncates the
  // description, so no name corroboration is required. Re-ingested catalogs can
  // hold duplicate rows for the same SKU, so collapse hits that resolve to the
  // same product (same normalized name) and only bail when the SKU genuinely
  // points at different products.
  if (vendorSupplierId && skuKey.length >= 3) {
    const supplierSkuHits = skuCandidates.filter((candidate) => candidate.t1)
    if (supplierSkuHits.length) {
      const distinct = new Set(
        supplierSkuHits.map((candidate) => normalizeProduct(candidate.row).nameTokens.join(" "))
      )
      if (distinct.size === 1) {
        return finalize(ctx, input, item, supplierSkuHits[0].row, "exact", 97, "line:supplier-sku")
      }
    }
  }

  // Tier 2: catalog-code blocking + scorePair, the same fuzzy path the product
  // matcher uses. Manufacturer SKU collisions are filtered by the scoring
  // ladder (short numeric SKUs need name corroboration).
  let best:
    | { row: SupplierProductRow; status: "exact" | "variant" | "needs_review"; confidence: number; reason: string }
    | null = null
  for (const candidate of skuCandidates) {
    if (!candidate.t2) {
      continue
    }
    const decision = scorePair(item, normalizeProduct(candidate.row))
    if (decision.status !== "exact" && decision.status !== "variant" && decision.status !== "needs_review") {
      continue
    }
    const rank = decision.status === "needs_review" ? 0 : 1
    const bestRank = best && best.status !== "needs_review" ? 1 : 0
    if (!best || rank > bestRank || (rank === bestRank && decision.confidence > best.confidence)) {
      best = { row: candidate.row, status: decision.status, confidence: decision.confidence, reason: `line:${decision.reason}` }
    }
  }
  if (best && best.status !== "needs_review") {
    return finalize(ctx, input, item, best.row, best.status, best.confidence, best.reason)
  }

  // Tier 3: no usable SKU evidence — best same-type product by name similarity
  // becomes a review-grade suggestion. Only now do we run the heavier
  // core-token retrieval.
  const nameCandidates = await fetchCandidates(ctx, item, skuKey, vendorSupplierId, { t3: true })
  const itemCore = new Set(item.coreTokens)
  const minShared = Math.min(MIN_SHARED_CORE_TOKENS, itemCore.size)
  let nameBest: { row: SupplierProductRow; sim: number } | null = null
  for (const candidate of nameCandidates) {
    if (!candidate.t3) {
      continue
    }
    let shared = 0
    for (const token of candidate.storedCoreTokens) {
      if (itemCore.has(token)) {
        shared += 1
      }
    }
    if (shared < minShared) {
      continue
    }
    const sim = nameOnlySimilarity(item, normalizeProduct(candidate.row))
    if (sim > (nameBest?.sim ?? 0)) {
      nameBest = { row: candidate.row, sim }
    }
  }

  if (nameBest && nameBest.sim >= NAME_ONLY_MIN_SIM) {
    const confidence = Math.round(40 + 30 * nameBest.sim)
    return finalize(
      ctx,
      input,
      item,
      nameBest.row,
      "needs_review",
      confidence,
      `line:needs_review name-sim=${nameBest.sim.toFixed(2)}`
    )
  }

  if (best) {
    return finalize(ctx, input, item, best.row, "needs_review", best.confidence, best.reason)
  }

  return unmatched(input, "line:unmatched no candidate above threshold")
}

/**
 * Match every line item on an invoice. Loads the supplier list once, resolves
 * the vendor, then retrieves + scores candidates per line via indexed SQL.
 */
export async function matchInvoice(
  pool: Pool,
  vendorName: string | undefined,
  lineItems: LineItemInput[]
): Promise<InvoiceMatchResult> {
  const suppliers = (
    await pool.query<{ id: string; name: string }>(
      `SELECT id, name FROM medmkp_supplier WHERE deleted_at IS NULL`
    )
  ).rows
  const supplierNameById = new Map(suppliers.map((supplier) => [supplier.id, supplier.name]))
  const vendorSupplierId = resolveVendorSupplier(suppliers, vendorName)
  const ctx: MatchContext = { pool, supplierNameById }

  const line_items = await Promise.all(
    lineItems.map((item) => matchLineItem(ctx, item, vendorSupplierId))
  )

  const countResult = await pool.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM medmkp_supplier_product_match_index`
  )

  return {
    vendor_supplier_id: vendorSupplierId,
    catalog_products: countResult.rows[0]?.n ?? 0,
    line_items,
  }
}
