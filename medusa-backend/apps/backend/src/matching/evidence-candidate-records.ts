import type {
  CandidateStrength,
  CandidateTargetType,
  EvidenceCandidateResult,
} from "./evidence-candidates"

// Bridge between the deterministic ranker (evidence-candidates.ts) and the
// persistence model (medmkp_evidence_match_candidate). The ranker is pure and
// DB-free; this turns its ranked, explainable output into the rows the review
// queue stores and loads. Kept pure so the mapping is exhaustively testable and
// so #337's candidate model has a single, documented producer.
//
// Trust rule preserved end to end: only the qualitative `strength` and the
// human-readable `reasons` are user-facing. The ranker deliberately withholds
// its numeric score, so `internal_score` stays null here — the column exists for
// a future ranker that wants to persist the internal value, never as a
// user-facing confidence percentage.

/** A row to insert into medmkp_evidence_match_candidate. Shape matches the
 * model in modules/medmkp/models/evidence-match-candidate.ts. */
export type EvidenceMatchCandidateRecord = {
  evidence_document_id: string
  practice_id: string
  evidence_extraction_id: string | null
  candidate_type: CandidateTargetType
  candidate_id: string
  label: string | null
  rank: number
  strength: CandidateStrength
  internal_score: number | null
  reason_codes: string[]
  reasons: string[]
  status: "proposed"
}

export type EvidenceMatchCandidateContext = {
  evidence_document_id: string
  practice_id: string
  /** The extraction that produced these, or null for metadata-only candidates. */
  evidence_extraction_id?: string | null
}

/**
 * Convert a ranker result into persistable candidate rows. The ranker already
 * returns candidates best-first, so rank is the 1-based position. All rows start
 * `proposed`; a human moves them to accepted/rejected in Match Review. A
 * `needs_manual_review` result with no candidates yields an empty list — the
 * caller persists the manual-review state on the document, not a fake candidate.
 */
export function toMatchCandidateRecords(
  context: EvidenceMatchCandidateContext,
  result: EvidenceCandidateResult
): EvidenceMatchCandidateRecord[] {
  return result.candidates.map((candidate, index) => ({
    evidence_document_id: context.evidence_document_id,
    practice_id: context.practice_id,
    evidence_extraction_id: context.evidence_extraction_id ?? null,
    candidate_type: candidate.target_type,
    candidate_id: candidate.target_id,
    label: candidate.label ?? null,
    rank: index + 1,
    strength: candidate.strength,
    // The ranker withholds its numeric score; persist the qualitative band only.
    internal_score: null,
    // The ranker emits human-readable reasons, not stable codes yet; the codes
    // column is reserved for when it does.
    reason_codes: [],
    reasons: candidate.reasons,
    status: "proposed",
  }))
}
