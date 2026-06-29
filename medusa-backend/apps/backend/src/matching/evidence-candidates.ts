import { normalizeSku, skuStrength, tokenizeName } from "./normalize"
import { canonicalGtin, gtinVariants } from "./gtin"

// Deterministic candidate generation for Evidence Match Review.
//
// Given the metadata already stored on a compliance evidence document (or an
// extraction row), propose the inventory items, catalog products, supplier
// products, and locations the document most likely belongs to — so a reviewer
// confirms a short ranked list instead of searching by hand. This is NOT OCR:
// it consumes fields that already exist (SKU, manufacturer SKU, barcode, product
// name, lot number, expiry, a location hint), runs them through the same
// normalizers the product matcher uses, and ranks the existing inventory/catalog
// rows by how much identity evidence each carries.
//
// Two design rules from the product's review model:
//   1. Reasons are HUMAN-READABLE EVIDENCE LABELS, never percentages. The
//      ranking math (noisy-or over per-signal weights) stays internal; the
//      result exposes only a qualitative `strength` and plain-English `reasons`.
//   2. Weak or absent evidence yields a `needs_manual_review` status rather than
//      a falsely-confident guess, so a reviewer is told to decide by hand.
//
// Practice scoping is enforced at the data-source boundary: practice-owned rows
// (inventory items, locations) are only ever read for the evidence document's
// own practice, so candidates never leak across practices. The catalog
// (supplier/canonical products) is global identity data and is not scoped.

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/** The metadata signal read off an evidence document / extraction row. */
export type EvidenceSignal = {
  /** Required: the practice the evidence belongs to. Scopes all owned rows. */
  practice_id: string
  /** A SKU / item code printed on the document. */
  sku?: string | null
  /** A manufacturer / catalog number, when distinct from `sku`. */
  manufacturer_sku?: string | null
  /** A scanned or printed barcode (GTIN/UPC/EAN). */
  barcode?: string | null
  /** Product name / description text. */
  product_name?: string | null
  /** Manufacturer / brand name. */
  brand?: string | null
  /** Lot / batch number printed on the package. */
  lot_number?: string | null
  /** Expiration date (ISO string or Date). */
  expiration_date?: string | Date | null
  /** Free text naming a place ("Operatory 2", "Sterilization"). */
  location_hint?: string | null
  /** Document type, for context (unused in ranking today). */
  document_type?: string | null
}

export type InventoryCandidateRow = {
  id: string
  location_id: string
  name: string
  barcode?: string | null
  canonical_product_id?: string | null
  supplier_product_id?: string | null
  lot_number?: string | null
  expiration_date?: string | Date | null
}

export type LocationCandidateRow = {
  id: string
  name: string
  type?: string | null
}

export type SupplierProductCandidateRow = {
  id: string
  supplier_id: string
  sku?: string | null
  manufacturer_sku?: string | null
  barcode?: string | null
  brand?: string | null
  name: string
  /** The catalog product this supplier listing resolves to, when matched. */
  canonical_product_id?: string | null
}

export type CanonicalCandidateRow = {
  id: string
  name: string
  handle?: string | null
  category?: string | null
}

/** The candidate pools the ranker scores. Each is already practice-scoped (for
 * owned rows) and pre-narrowed (for catalog rows) by the data source. */
export type EvidenceCandidatePools = {
  inventoryItems: InventoryCandidateRow[]
  locations: LocationCandidateRow[]
  supplierProducts: SupplierProductCandidateRow[]
  canonicalProducts: CanonicalCandidateRow[]
}

// ---------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------

export type CandidateTargetType =
  | "inventory_item"
  | "location"
  | "supplier_product"
  | "canonical_product"

/** Qualitative confidence band. Deliberately NOT a percentage. */
export type CandidateStrength = "strong" | "possible" | "weak"

export type EvidenceCandidate = {
  target_type: CandidateTargetType
  target_id: string
  /** Display name for the candidate row. */
  label: string
  strength: CandidateStrength
  /** Human-readable evidence labels. Never contain a percentage. */
  reasons: string[]
}

export type EvidenceCandidateResult = {
  /** `ok` when at least one non-weak candidate was found; otherwise the
   * reviewer is asked to decide by hand. */
  status: "ok" | "needs_manual_review"
  /** Ranked best-first. */
  candidates: EvidenceCandidate[]
  /** Why nothing confident surfaced, when `status` is `needs_manual_review`. */
  manual_review_reason?: string
}

// ---------------------------------------------------------------------------
// Ranking internals (never surfaced to the user)
// ---------------------------------------------------------------------------

type WeightedReason = { text: string; weight: number }

// Per-signal evidence weights, 0..1, on the same scale the product matcher uses.
// Combined with noisy-or so corroborating signals reinforce each other.
const W = {
  barcode: 0.97,
  // Lot alone is suggestive (codes repeat across items), but lot AND expiry on
  // the same physical package is strong evidence — the noisy-or of the two
  // (0.7, 0.4) clears the strong floor while either alone stays below it.
  lotNumber: 0.7,
  expiry: 0.4,
  nameStrong: 0.55,
  namePartial: 0.3,
  locationStrong: 0.72,
  locationPartial: 0.42,
}

// A candidate must clear this to be reported at all; below it the signal is
// noise (e.g. a lone collision-prone numeric SKU).
const REPORT_FLOOR = 0.3
// At or above this a candidate is worth a confident look; below it is "weak".
const POSSIBLE_FLOOR = 0.45
// At or above this the evidence is strong.
const STRONG_FLOOR = 0.8

function combine(reasons: WeightedReason[]): number {
  // Noisy-or: 1 - Π(1 - w). Independent signals raise confidence together.
  let miss = 1
  for (const r of reasons) miss *= 1 - clamp01(r.weight)
  return 1 - miss
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v))
}

function bandFor(score: number): CandidateStrength {
  if (score >= STRONG_FLOOR) return "strong"
  if (score >= POSSIBLE_FLOOR) return "possible"
  return "weak"
}

const STRENGTH_RANK: Record<CandidateStrength, number> = {
  strong: 3,
  possible: 2,
  weak: 1,
}

function normalizeLot(value: string | null | undefined): string {
  if (!value) return ""
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "")
}

/** Calendar day key (UTC) for expiry comparison; "" when unparseable. */
function dayKey(value: string | Date | null | undefined): string {
  if (!value) return ""
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return ""
  return d.toISOString().slice(0, 10)
}

/** Fraction of the signal's name tokens present in a candidate name (recall). */
function nameRecall(signalTokens: string[], candidateName: string): number {
  if (!signalTokens.length) return 0
  const candidate = new Set(tokenizeName(candidateName))
  if (!candidate.size) return 0
  let shared = 0
  for (const token of signalTokens) if (candidate.has(token)) shared += 1
  return shared / signalTokens.length
}

function nameReason(
  signalTokens: string[],
  candidateName: string,
  noun: string
): WeightedReason | null {
  const recall = nameRecall(signalTokens, candidateName)
  if (recall >= 0.6) return { text: `Product name matches this ${noun}`, weight: W.nameStrong }
  if (recall >= 0.34) return { text: `Product name partly matches this ${noun}`, weight: W.namePartial }
  return null
}

/** How much identity an exact SKU collision carries, as an evidence weight.
 * Reuses the matcher's skuStrength so short/numeric codes (which collide across
 * makers) stay weak and must be corroborated by name. */
function skuReasonWeight(sku: string): number {
  return clamp01(skuStrength(sku))
}

// ---------------------------------------------------------------------------
// The ranker
// ---------------------------------------------------------------------------

/**
 * Pure, deterministic candidate ranking. Takes the evidence signal and the
 * candidate pools and returns the ranked candidates with human-readable
 * reasons. No I/O, no clock, no randomness — same input always yields the same
 * output, which is what makes it exhaustively testable.
 */
export function rankEvidenceCandidates(
  signal: EvidenceSignal,
  pools: EvidenceCandidatePools
): EvidenceCandidateResult {
  const sigSku = normalizeSku(signal.sku)
  const sigMfr = normalizeSku(signal.manufacturer_sku)
  const sigGtin = signal.barcode ? canonicalGtin(signal.barcode) : null
  const sigLot = normalizeLot(signal.lot_number)
  const sigExpiry = dayKey(signal.expiration_date ?? null)
  const sigNameTokens = signal.product_name ? tokenizeName(signal.product_name) : []
  const sigLocationTokens = signal.location_hint ? tokenizeName(signal.location_hint) : []

  const hasAnySignal =
    Boolean(sigSku || sigMfr || sigGtin || sigLot || sigExpiry) ||
    sigNameTokens.length > 0 ||
    sigLocationTokens.length > 0

  const candidates: EvidenceCandidate[] = []
  // Locations surfaced because they hold a matched inventory item are merged
  // with any direct location-hint match, so a location appears once.
  const locationReasons = new Map<string, WeightedReason[]>()

  // -- Supplier products: SKU / manufacturer SKU / barcode / name -------------
  // Track which catalog products a strong supplier hit resolves to, so the
  // canonical product can be promoted as its own candidate.
  const canonicalFromSupplier = new Map<string, WeightedReason[]>()
  for (const sp of pools.supplierProducts) {
    const reasons: WeightedReason[] = []
    const spSku = normalizeSku(sp.sku)
    const spMfr = normalizeSku(sp.manufacturer_sku)
    const spGtin = sp.barcode ? canonicalGtin(sp.barcode) : null

    if (sigGtin && spGtin && sigGtin === spGtin) {
      reasons.push({ text: "Barcode (GTIN) matches this product", weight: W.barcode })
    }
    if (sigSku && (spSku === sigSku || spMfr === sigSku)) {
      reasons.push({ text: "Catalog SKU matches the code on the document", weight: skuReasonWeight(sigSku) })
    }
    if (sigMfr && sigMfr !== sigSku && (spMfr === sigMfr || spSku === sigMfr)) {
      reasons.push({ text: "Manufacturer SKU matches the document", weight: skuReasonWeight(sigMfr) })
    }
    const nr = nameReason(sigNameTokens, sp.name, "product")
    if (nr) reasons.push(nr)

    if (!reasons.length) continue
    const score = combine(reasons)
    if (score < REPORT_FLOOR) continue
    candidates.push({
      target_type: "supplier_product",
      target_id: sp.id,
      label: sp.name,
      strength: bandFor(score),
      reasons: reasons.map((r) => r.text),
    })

    // Promote the resolved catalog product, carrying why it matched.
    if (sp.canonical_product_id && score >= POSSIBLE_FLOOR) {
      const existing = canonicalFromSupplier.get(sp.canonical_product_id) ?? []
      existing.push({
        text: `Carried by supplier listing ${sp.sku || sp.name} that matches the document`,
        weight: score,
      })
      canonicalFromSupplier.set(sp.canonical_product_id, existing)
    }
  }

  // -- Canonical products: name match + promotion from supplier hits ----------
  const canonicalById = new Map(pools.canonicalProducts.map((c) => [c.id, c]))
  const canonicalReasons = new Map<string, WeightedReason[]>()
  for (const cp of pools.canonicalProducts) {
    const reasons: WeightedReason[] = []
    const nr = nameReason(sigNameTokens, cp.name, "catalog product")
    if (nr) reasons.push(nr)
    if (reasons.length) canonicalReasons.set(cp.id, reasons)
  }
  for (const [canonicalId, reasons] of canonicalFromSupplier) {
    const merged = canonicalReasons.get(canonicalId) ?? []
    merged.push(...reasons)
    canonicalReasons.set(canonicalId, merged)
  }
  for (const [canonicalId, reasons] of canonicalReasons) {
    const cp = canonicalById.get(canonicalId)
    if (!cp) continue
    const score = combine(reasons)
    if (score < REPORT_FLOOR) continue
    candidates.push({
      target_type: "canonical_product",
      target_id: cp.id,
      label: cp.name,
      strength: bandFor(score),
      reasons: reasons.map((r) => r.text),
    })
  }

  // -- Inventory items: barcode / lot / expiry / name -------------------------
  for (const item of pools.inventoryItems) {
    const reasons: WeightedReason[] = []
    const itemGtin = item.barcode ? canonicalGtin(item.barcode) : null
    if (sigGtin && itemGtin && sigGtin === itemGtin) {
      reasons.push({ text: "Barcode matches this shelf item", weight: W.barcode })
    }
    if (sigLot && normalizeLot(item.lot_number) === sigLot) {
      reasons.push({ text: "Lot number matches this shelf item", weight: W.lotNumber })
    }
    if (sigExpiry && dayKey(item.expiration_date ?? null) === sigExpiry) {
      reasons.push({ text: "Expiration date matches this shelf item", weight: W.expiry })
    }
    const nr = nameReason(sigNameTokens, item.name, "shelf item")
    if (nr) reasons.push(nr)

    if (!reasons.length) continue
    const score = combine(reasons)
    if (score < REPORT_FLOOR) continue
    candidates.push({
      target_type: "inventory_item",
      target_id: item.id,
      label: item.name,
      strength: bandFor(score),
      reasons: reasons.map((r) => r.text),
    })

    // The location holding a likely shelf item is itself a candidate location.
    if (score >= POSSIBLE_FLOOR) {
      const existing = locationReasons.get(item.location_id) ?? []
      existing.push({ text: `Holds “${item.name}”, a likely match for this evidence`, weight: score * 0.85 })
      locationReasons.set(item.location_id, existing)
    }
  }

  // -- Locations: hint text + holding a matched item --------------------------
  for (const loc of pools.locations) {
    const reasons: WeightedReason[] = locationReasons.get(loc.id) ?? []
    if (sigLocationTokens.length) {
      const nameRec = nameRecall(sigLocationTokens, loc.name)
      const typeRec = loc.type ? nameRecall(sigLocationTokens, loc.type) : 0
      const rec = Math.max(nameRec, typeRec)
      if (rec >= 0.6) reasons.push({ text: "Evidence names this location", weight: W.locationStrong })
      else if (rec >= 0.34) reasons.push({ text: "Evidence partly names this location", weight: W.locationPartial })
    }
    if (!reasons.length) continue
    const score = combine(reasons)
    if (score < REPORT_FLOOR) continue
    candidates.push({
      target_type: "location",
      target_id: loc.id,
      label: loc.name,
      strength: bandFor(score),
      reasons: reasons.map((r) => r.text),
    })
  }

  // Stable best-first order: strength, then number of corroborating reasons,
  // then id — never random, so the reviewer's list doesn't shuffle.
  candidates.sort(
    (a, b) =>
      STRENGTH_RANK[b.strength] - STRENGTH_RANK[a.strength] ||
      b.reasons.length - a.reasons.length ||
      a.target_id.localeCompare(b.target_id)
  )

  const hasConfident = candidates.some((c) => c.strength !== "weak")
  if (hasConfident) {
    return { status: "ok", candidates }
  }

  return {
    status: "needs_manual_review",
    candidates,
    manual_review_reason: hasAnySignal
      ? "The document's metadata did not match any inventory item, product, or location strongly enough to propose. Match it by hand."
      : "The document carries no identifying metadata to match on. Match it by hand.",
  }
}

// ---------------------------------------------------------------------------
// Data source seam + orchestrator
// ---------------------------------------------------------------------------

/**
 * Supplies the candidate pools for a signal. Practice-owned rows MUST be scoped
 * to `practiceId` so candidates never leak across practices; the catalog is
 * global. Implemented over the medmkp service by
 * {@link medmkpEvidenceCandidateSource}; stubbed in tests.
 */
export interface EvidenceCandidateSource {
  practiceInventory(practiceId: string): Promise<InventoryCandidateRow[]>
  practiceLocations(practiceId: string): Promise<LocationCandidateRow[]>
  catalogCandidates(signal: EvidenceSignal): Promise<{
    supplierProducts: SupplierProductCandidateRow[]
    canonicalProducts: CanonicalCandidateRow[]
  }>
}

/** Fetch the pools through a source, then rank them. */
export async function generateEvidenceCandidates(
  signal: EvidenceSignal,
  source: EvidenceCandidateSource
): Promise<EvidenceCandidateResult> {
  const [inventoryItems, locations, catalog] = await Promise.all([
    source.practiceInventory(signal.practice_id),
    source.practiceLocations(signal.practice_id),
    source.catalogCandidates(signal),
  ])
  return rankEvidenceCandidates(signal, {
    inventoryItems,
    locations,
    supplierProducts: catalog.supplierProducts,
    canonicalProducts: catalog.canonicalProducts,
  })
}

/** The slice of the medmkp service the source needs. Keeps the binding small
 * and the source unit-testable with a fake. */
export type EvidenceCandidateMedmkp = {
  listLocations(filter: { practice_id: string }, config?: unknown): Promise<Array<{ id: string; name: string; type?: string | null }>>
  listInventoryItems(filter: { location_id: string[] }): Promise<InventoryCandidateRow[]>
  listSupplierProducts(filter: Record<string, unknown>): Promise<SupplierProductCandidateRow[]>
  listCanonicalProductMatches(filter: { supplier_product_id: string[] }): Promise<Array<{ supplier_product_id: string; canonical_product_id: string; match_status: string }>>
  listCanonicalProducts(filter: { id: string[] }): Promise<CanonicalCandidateRow[]>
}

function dedupeById<T extends { id: string }>(rows: T[]): T[] {
  const seen = new Map<string, T>()
  for (const row of rows) if (!seen.has(row.id)) seen.set(row.id, row)
  return [...seen.values()]
}

/**
 * Concrete source over the medmkp module service. Practice scoping is real:
 * inventory is read only for the practice's own locations, so another practice's
 * shelf items can never enter the candidate pool.
 */
export function medmkpEvidenceCandidateSource(
  medmkp: EvidenceCandidateMedmkp
): EvidenceCandidateSource {
  return {
    async practiceLocations(practiceId) {
      const locations = await medmkp.listLocations({ practice_id: practiceId })
      return locations.map((l) => ({ id: l.id, name: l.name, type: l.type ?? null }))
    },

    async practiceInventory(practiceId) {
      const locations = await medmkp.listLocations({ practice_id: practiceId })
      const locationIds = locations.map((l) => l.id)
      if (!locationIds.length) return []
      const items = await medmkp.listInventoryItems({ location_id: locationIds })
      // Belt-and-suspenders: only items at this practice's locations.
      const owned = new Set(locationIds)
      return items.filter((i) => owned.has(i.location_id))
    },

    async catalogCandidates(signal) {
      const skuVariants = [
        ...new Set(
          [signal.sku, signal.manufacturer_sku]
            .filter((v): v is string => Boolean(v && v.trim()))
            .flatMap((v) => [v.trim(), v.trim().toUpperCase()])
        ),
      ]
      const barcodeVariants = signal.barcode ? gtinVariants(signal.barcode) : []

      const lookups: Promise<SupplierProductCandidateRow[]>[] = []
      if (skuVariants.length) {
        lookups.push(medmkp.listSupplierProducts({ sku: skuVariants }))
        lookups.push(medmkp.listSupplierProducts({ manufacturer_sku: skuVariants }))
      }
      if (barcodeVariants.length) {
        lookups.push(medmkp.listSupplierProducts({ barcode: barcodeVariants }))
      }
      const supplierProducts = dedupeById((await Promise.all(lookups)).flat())

      if (!supplierProducts.length) {
        return { supplierProducts: [], canonicalProducts: [] }
      }

      // Resolve catalog products for the matched supplier listings.
      const matches = (
        await medmkp.listCanonicalProductMatches({
          supplier_product_id: supplierProducts.map((sp) => sp.id),
        })
      ).filter((m) => m.match_status === "exact" || m.match_status === "variant")
      const canonicalBySupplier = new Map(matches.map((m) => [m.supplier_product_id, m.canonical_product_id]))
      for (const sp of supplierProducts) {
        const canonicalId = canonicalBySupplier.get(sp.id)
        if (canonicalId) sp.canonical_product_id = canonicalId
      }

      const canonicalIds = [...new Set([...canonicalBySupplier.values()])]
      const canonicalProducts = canonicalIds.length
        ? await medmkp.listCanonicalProducts({ id: canonicalIds })
        : []

      return { supplierProducts, canonicalProducts }
    },
  }
}
