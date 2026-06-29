// Evidence document versioning — pure domain logic for the immutable version
// chain behind an evidence document (medmkp_evidence_document_version).
//
// A document is the stable identity; each captured file + the fields extracted
// from it is a frozen *version*. A document has at most one "accepted" version
// (its current truth) and any number of "pending" (awaiting review) or
// "superseded" (replaced) ones. Re-capturing a file creates a NEW version — it
// never edits an existing one. Only review/status metadata changes after
// creation; the captured snapshot is immutable (FROZEN_VERSION_FIELDS).
//
// Everything here is pure (no DB) so the caller (API/workflow) computes the
// next state and persists it, and the rules stay unit-testable.

export const VERSION_STATUSES = [
  "pending",
  "accepted",
  "superseded",
  "rejected",
] as const
export type VersionStatus = (typeof VERSION_STATUSES)[number]

export const VERSION_SOURCE_KINDS = [
  "upload",
  "scan",
  "email",
  "import",
  "api",
  "manual",
  "other",
] as const
export type VersionSourceKind = (typeof VERSION_SOURCE_KINDS)[number]

// Snapshot fields frozen at capture time — immutable for the life of the row.
// Only status/review metadata may change afterwards.
export const FROZEN_VERSION_FIELDS = [
  "evidence_document_id",
  "practice_id",
  "version_number",
  "file_name",
  "file_mime_type",
  "file_extension",
  "file_size_bytes",
  "storage_key",
  "file_hash",
  "extracted_fields",
  "source_kind",
  "captured_by",
  "captured_at",
] as const

export interface EvidenceVersion {
  id?: string
  evidence_document_id: string
  practice_id: string
  version_number: number
  status: VersionStatus
  accepted_at?: Date | string | null
  accepted_by?: string | null
  superseded_at?: Date | string | null
  superseded_by_version_id?: string | null
  rejected_at?: Date | string | null
  rejected_by?: string | null
  [k: string]: any
}

// The next version number for a document: one past the highest existing one
// (numbers are monotonic per document and start at 1).
export function nextVersionNumber(
  existing: { version_number?: number | null }[]
): number {
  return (
    existing.reduce((max, v) => Math.max(max, v.version_number ?? 0), 0) + 1
  )
}

// Build a new version row (status "pending") for a document, assigning the
// next version number and defaulting capture/lifecycle fields. The caller
// persists the result; it is not accepted until acceptVersion runs.
export function buildVersionDraft<T extends Record<string, any>>(
  input: T & { evidence_document_id: string; practice_id: string },
  existing: { version_number?: number | null }[] = [],
  now: Date = new Date()
): T & EvidenceVersion {
  return {
    ...input,
    version_number: nextVersionNumber(existing),
    status: "pending",
    captured_at: input.captured_at ?? now,
    accepted_at: null,
    accepted_by: null,
    superseded_at: null,
    superseded_by_version_id: null,
    rejected_at: null,
    rejected_by: null,
  }
}

export interface AcceptResult<T> {
  versions: T[]
  currentVersionId: string
}

// Accept one version of a document: it becomes the current accepted version,
// and the previously accepted version (if any) is superseded. Returns the full
// updated version set plus the id the document's current_version_id should
// point to. Pure — the caller persists the changed rows + the pointer. Pending
// siblings are left untouched.
export function acceptVersion<T extends EvidenceVersion>(
  versions: T[],
  versionId: string,
  opts: { now?: Date; actor?: string | null } = {}
): AcceptResult<T> {
  const target = versions.find((v) => v.id === versionId)
  if (!target) {
    throw new Error(`evidence version "${versionId}" not found`)
  }
  const now = opts.now ?? new Date()
  const actor = opts.actor ?? null
  const versionsOut = versions.map((v) => {
    if (v.id === versionId) {
      return {
        ...v,
        status: "accepted" as VersionStatus,
        accepted_at: now,
        accepted_by: actor,
        superseded_at: null,
        superseded_by_version_id: null,
      }
    }
    if (v.status === "accepted") {
      return {
        ...v,
        status: "superseded" as VersionStatus,
        superseded_at: now,
        superseded_by_version_id: versionId,
      }
    }
    return v
  })
  return { versions: versionsOut, currentVersionId: versionId }
}

// The accepted version derived from the set — the fallback path when a
// document's explicit current_version_id pointer is absent or stale. There is
// at most one (enforced by a partial unique index).
export function deriveCurrentVersion<T extends EvidenceVersion>(
  versions: T[]
): T | null {
  return versions.find((v) => v.status === "accepted") ?? null
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true
  // Dates and JSON snapshots compare by value, not reference.
  if (a instanceof Date || b instanceof Date) {
    return new Date(a as any).getTime() === new Date(b as any).getTime()
  }
  if (a && b && typeof a === "object" && typeof b === "object") {
    return JSON.stringify(a) === JSON.stringify(b)
  }
  return false
}

// Apply a status/review change to an existing version while enforcing the
// immutability of the captured snapshot: any attempt to change a
// FROZEN_VERSION_FIELD throws. This is the guard the "immutable after creation
// except for review/status metadata" rule relies on.
export function applyStatusUpdate<T extends EvidenceVersion>(
  existing: T,
  patch: Partial<T>
): T {
  for (const field of FROZEN_VERSION_FIELDS) {
    if (field in patch && !sameValue((patch as any)[field], existing[field])) {
      throw new Error(`evidence version field "${field}" is immutable`)
    }
  }
  return { ...existing, ...patch }
}
