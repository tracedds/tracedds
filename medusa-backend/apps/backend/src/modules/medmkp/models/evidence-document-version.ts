import { model } from "@medusajs/framework/utils"

// One immutable version in an evidence document's history. A document
// (medmkp_evidence_document) is the stable identity; each captured file +
// the fields extracted from it is recorded here as a frozen snapshot. A
// document has at most one "accepted" version (its current truth) and any
// number of "pending" (awaiting review) or "superseded" (replaced) ones.
//
// Everything except the review/status metadata (status, accepted_*,
// superseded_*, rejected_*, review_note) is immutable once the row exists:
// re-capturing a file creates a NEW version, it never edits an existing one.
// The lifecycle rules are enforced in pure form in
// src/utils/evidence-versioning.ts.
const EvidenceDocumentVersion = model.define("medmkp_evidence_document_version", {
  id: model.id({ prefix: "evver" }).primaryKey(),
  evidence_document_id: model.text().searchable(),
  practice_id: model.text(),
  // Monotonic per document, starting at 1.
  version_number: model.number(),
  status: model
    .enum(["pending", "accepted", "superseded", "rejected"])
    .default("pending"),

  // --- File identity / object-key metadata (frozen at capture) ---
  // Bytes live in object storage; storage_key resolves a presigned URL later.
  file_name: model.text().nullable(),
  file_mime_type: model.text().nullable(),
  file_extension: model.text().nullable(),
  file_size_bytes: model.number().nullable(),
  storage_key: model.text().nullable(),
  // Content hash of the stored bytes, for dedup / integrity (frozen).
  file_hash: model.text().nullable(),

  // --- Extracted fields snapshot (frozen) ---
  // The structured fields pulled from this file at capture time, frozen so a
  // later re-extraction or schema change can't rewrite history.
  extracted_fields: model.json().nullable(),

  // --- Provenance (frozen) ---
  source_kind: model
    .enum(["upload", "scan", "email", "import", "api", "manual", "other"])
    .default("upload"),

  // --- Actor / capture (frozen) ---
  captured_by: model.text().nullable(),
  captured_at: model.dateTime().nullable(),

  // --- Review / status metadata (the only mutable part after creation) ---
  accepted_at: model.dateTime().nullable(),
  accepted_by: model.text().nullable(),
  superseded_at: model.dateTime().nullable(),
  // The version that replaced this one (set when it is superseded).
  superseded_by_version_id: model.text().nullable(),
  rejected_at: model.dateTime().nullable(),
  rejected_by: model.text().nullable(),
  review_note: model.text().nullable(),
})

export default EvidenceDocumentVersion
