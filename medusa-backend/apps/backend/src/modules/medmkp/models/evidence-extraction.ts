import { model } from "@medusajs/framework/utils"

// One field-extraction record per evidence document — the EXTRACTION lifecycle,
// kept deliberately separate from evidence_document.status (which is the human
// review / coverage lifecycle: missing/captured/partial/verified/...). This is
// the persistence the Evidence Match Review feature reads: it records whether a
// document's fields have been pulled yet, the structured fields once they have,
// and any failure detail — without committing to an OCR / document-AI provider.
//
// The provider + in-process drainer are a later ticket (#342); see
// docs/EVIDENCE_EXTRACTION.md for the architecture. The status enum and the
// claim/attempt columns are the contract that drainer fills in — present now so
// the schema is stable, but NO worker is added here. The structured field shape
// (each field = { value, source: { text, page } }, never a confidence %) is also
// documented there.
const EvidenceExtraction = model.define("medmkp_evidence_extraction", {
  id: model.id({ prefix: "evext" }).primaryKey(),
  evidence_document_id: model.text().searchable(),
  practice_id: model.text(),
  // The immutable document version whose bytes were extracted, when extraction
  // ran against a specific captured version (medmkp_evidence_document_version).
  evidence_document_version_id: model.text().nullable(),
  // The blob the extractor reads (object storage); mirrors the document's key.
  storage_key: model.text().nullable(),
  status: model
    .enum(["queued", "processing", "extracted", "failed", "manual"])
    .default("queued"),
  // Bounded retry bookkeeping for the future drainer (#342). No worker here.
  attempts: model.number().default(0),
  // The structured fields pulled from the document, each carrying its own source
  // snippet rather than a confidence percentage. Shape in EVIDENCE_EXTRACTION.md.
  extracted_fields: model.json().nullable(),
  // Which model/provider produced the fields, recorded for traceability once a
  // provider exists. Null until then — this issue adds no provider.
  extracted_by_model: model.text().nullable(),
  error: model.text().nullable(),
  // Claim / completion timestamps for the future drainer's stale-reaping.
  claimed_at: model.dateTime().nullable(),
  finished_at: model.dateTime().nullable(),
})

export default EvidenceExtraction
