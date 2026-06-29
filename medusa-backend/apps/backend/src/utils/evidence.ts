import type { MedusaResponse } from "@medusajs/framework/http"
import type MedMKPModuleService from "../modules/medmkp/service"

// Evidence-document enums, mirrored from the model (medmkp_evidence_document) so
// the API layer can validate before writing. Keep these in sync with the model +
// migration check constraints.
export const EVIDENCE_DOCUMENT_TYPES = [
  "sds",
  "ifu",
  "expiration",
  "lot",
  "service",
  "price",
  "waterline",
  "other",
] as const
export type EvidenceDocumentType = (typeof EVIDENCE_DOCUMENT_TYPES)[number]

export const EVIDENCE_STATUSES = [
  "missing",
  "captured",
  "partial",
  "verified",
  "rejected",
  "archived",
] as const
export type EvidenceStatus = (typeof EVIDENCE_STATUSES)[number]

// Statuses that represent a completed human review, used to stamp reviewed_at/by.
export const EVIDENCE_REVIEWED_STATUSES = ["verified", "rejected"] as const

// Linkage filters the list endpoint accepts as exact-match query params. Each is
// indexed on the table, so they're cheap to filter on.
const LINKAGE_FILTERS = [
  "inventory_item_id",
  "canonical_product_id",
  "supplier_id",
  "supplier_product_id",
  "location_id",
] as const

// Editable free-text fields (nullable). Empty strings collapse to null so a
// cleared field reads back consistently.
const TEXT_FIELDS = [
  "file_name",
  "file_mime_type",
  "file_extension",
  "storage_key",
  "source",
  "inventory_item_id",
  "canonical_product_id",
  "supplier_id",
  "supplier_product_id",
  "location_id",
  "lot_number",
  "review_note",
  "reviewed_by",
  "notes",
] as const

const DATE_FIELDS = ["expiration_date", "review_due_at", "reviewed_at", "uploaded_at"] as const

export type EvidenceWriteResult = { error: string } | { fields: Record<string, any> }

function coerceText(v: any): string | null {
  if (v === null) return null
  if (typeof v === "string") return v.trim() || null
  return String(v)
}

// Validate + project a request body into a writable evidence-document field set.
// On create, document_type is required; on update everything is optional and only
// supplied keys are touched (partial update). Unknown keys (id, practice_id,
// created_at, …) are ignored — never mass-assigned. Returns { error } on the
// first validation failure so the caller can answer 422.
export function buildEvidenceWrite(
  body: Record<string, any>,
  opts: { isCreate: boolean }
): EvidenceWriteResult {
  const fields: Record<string, any> = {}

  if (opts.isCreate || body.document_type !== undefined) {
    if (!EVIDENCE_DOCUMENT_TYPES.includes(body.document_type)) {
      return {
        error: `Invalid document_type. Expected one of: ${EVIDENCE_DOCUMENT_TYPES.join(", ")}.`,
      }
    }
    fields.document_type = body.document_type
  }

  if (body.status !== undefined) {
    if (!EVIDENCE_STATUSES.includes(body.status)) {
      return { error: `Invalid status. Expected one of: ${EVIDENCE_STATUSES.join(", ")}.` }
    }
    fields.status = body.status
  }

  for (const f of TEXT_FIELDS) {
    if (body[f] !== undefined) fields[f] = coerceText(body[f])
  }

  if (body.file_size_bytes !== undefined) {
    if (body.file_size_bytes === null) {
      fields.file_size_bytes = null
    } else {
      const n = Number(body.file_size_bytes)
      if (!Number.isFinite(n) || n < 0) {
        return { error: "Invalid file_size_bytes. Expected a non-negative number." }
      }
      fields.file_size_bytes = n
    }
  }

  for (const f of DATE_FIELDS) {
    if (body[f] === undefined) continue
    if (body[f] === null) {
      fields[f] = null
      continue
    }
    const d = new Date(body[f])
    if (Number.isNaN(d.getTime())) {
      return { error: `Invalid ${f}. Expected an ISO-8601 date.` }
    }
    fields[f] = d
  }

  return { fields }
}

// Build the practice-scoped list filter from query params, validating any
// enum filters. Returns { error } so the caller can answer 422 on a bad value.
export function buildEvidenceListFilter(
  practiceId: string,
  query: Record<string, any>
): { error: string } | { filter: Record<string, any> } {
  const filter: Record<string, any> = { practice_id: practiceId }

  if (query.document_type !== undefined) {
    if (!EVIDENCE_DOCUMENT_TYPES.includes(query.document_type)) {
      return {
        error: `Invalid document_type. Expected one of: ${EVIDENCE_DOCUMENT_TYPES.join(", ")}.`,
      }
    }
    filter.document_type = query.document_type
  }

  if (query.status !== undefined) {
    if (!EVIDENCE_STATUSES.includes(query.status)) {
      return { error: `Invalid status. Expected one of: ${EVIDENCE_STATUSES.join(", ")}.` }
    }
    filter.status = query.status
  }

  for (const f of LINKAGE_FILTERS) {
    if (typeof query[f] === "string" && query[f]) filter[f] = query[f]
  }

  return { filter }
}

// Load one evidence document, enforcing it belongs to the caller's practice.
// Writes a 404 and returns null when missing or cross-practice, so the route can
// early-return (mirrors loadOwnedLocation).
export async function loadOwnedEvidence(
  medmkp: MedMKPModuleService,
  id: string,
  practiceId: string,
  res: MedusaResponse
): Promise<any | null> {
  const doc = await medmkp.retrieveEvidenceDocument(id).catch(() => null)
  if (!doc || doc.practice_id !== practiceId) {
    res.status(404).json({ error: "Evidence document not found." })
    return null
  }
  return doc
}
