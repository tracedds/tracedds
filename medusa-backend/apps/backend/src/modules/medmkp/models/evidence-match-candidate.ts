import { model } from "@medusajs/framework/utils"

// One proposed match between an evidence document and an existing record (a
// shelf inventory item, a stockroom location, a supplier listing, or a catalog
// product). The deterministic ranker in src/matching/evidence-candidates.ts
// produces these from the document's metadata (or a future extraction); a human
// then confirms one in Match Review. Persisting them lets the review queue load
// a stable, ranked shortlist instead of re-ranking on every view.
//
// Trust rule (shared with PRODUCT_MATCHING.md and the ranker): the qualitative
// `strength` band and the human-readable `reasons` are user-facing; the numeric
// `internal_score` is internal ranking math and is NEVER shown as a confidence
// percentage.
const EvidenceMatchCandidate = model.define("medmkp_evidence_match_candidate", {
  id: model.id({ prefix: "evmc" }).primaryKey(),
  evidence_document_id: model.text().searchable(),
  practice_id: model.text(),
  // The extraction run that produced this candidate, when it came from extracted
  // fields rather than the document's stored metadata. Null for metadata-only.
  evidence_extraction_id: model.text().nullable(),

  // --- What is being proposed -------------------------------------------------
  candidate_type: model.enum([
    "inventory_item",
    "location",
    "supplier_product",
    "canonical_product",
  ]),
  // The id of the proposed target row (an inventory item / location / supplier
  // product / canonical product id, per candidate_type).
  candidate_id: model.text().searchable(),
  // Display label for the candidate row, captured at generation time.
  label: model.text().nullable(),

  // --- Ranking ---------------------------------------------------------------
  // 1-based position in the ranked shortlist (best first), stable per document.
  rank: model.number(),
  // Qualitative evidence band — user-facing. Deliberately not a percentage.
  strength: model.enum(["strong", "possible", "weak"]),
  // Internal noisy-or ranking score (0..1). Internal ONLY — never surfaced as a
  // user-facing confidence percentage. Nullable: the ranker may withhold it.
  internal_score: model.number().nullable(),

  // --- Why --------------------------------------------------------------------
  // Stable machine reason codes (e.g. "barcode", "catalog_sku"), for filtering
  // and analytics. Empty until the ranker emits codes; reasons carry the text.
  reason_codes: model.json().nullable(),
  // Human-readable evidence labels shown to the reviewer (never a percentage).
  reasons: model.json().nullable(),

  // --- Review lifecycle -------------------------------------------------------
  // proposed → the ranker's suggestion awaiting review; accepted/rejected once a
  // human decides; superseded when a newer generation replaces it.
  status: model
    .enum(["proposed", "accepted", "rejected", "superseded"])
    .default("proposed"),
  decided_at: model.dateTime().nullable(),
  decided_by: model.text().nullable(),
})

export default EvidenceMatchCandidate
