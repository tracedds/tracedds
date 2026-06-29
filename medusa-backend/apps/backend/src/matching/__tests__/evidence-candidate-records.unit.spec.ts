import { rankEvidenceCandidates } from "../evidence-candidates"
import { toMatchCandidateRecords } from "../evidence-candidate-records"

// Every user-facing string a candidate row carries must be a plain label, never
// a percentage or numeric confidence — the persistence layer must not introduce
// what the ranker is careful to withhold.
function looksLikePercentage(s: string): boolean {
  return /\d\s*%/.test(s) || /\bconfidence\b/i.test(s)
}

describe("toMatchCandidateRecords — ranker output → persistence rows", () => {
  const context = {
    evidence_document_id: "evdoc_1",
    practice_id: "prac_a",
    evidence_extraction_id: "evext_1",
  }

  it("maps ranked candidates into 1-based, document-scoped, proposed rows", () => {
    const result = rankEvidenceCandidates(
      { practice_id: "prac_a", barcode: "00827229001234", product_name: "OptiBond Universal" },
      {
        inventoryItems: [
          { id: "inv_1", location_id: "loc_1", name: "OptiBond Universal", barcode: "00827229001234" },
        ],
        locations: [{ id: "loc_1", name: "Operatory 2" }],
        supplierProducts: [
          { id: "sp_1", supplier_id: "sup_1", barcode: "00827229001234", name: "OptiBond Universal Bottle" },
        ],
        canonicalProducts: [],
      }
    )

    const rows = toMatchCandidateRecords(context, result)

    expect(rows.length).toBe(result.candidates.length)
    expect(rows.length).toBeGreaterThan(0)

    rows.forEach((row, i) => {
      // Rank is the 1-based position in the ranker's best-first order.
      expect(row.rank).toBe(i + 1)
      expect(row.status).toBe("proposed")
      expect(row.evidence_document_id).toBe("evdoc_1")
      expect(row.practice_id).toBe("prac_a")
      expect(row.evidence_extraction_id).toBe("evext_1")
      // The target carried through faithfully.
      expect(row.candidate_type).toBe(result.candidates[i].target_type)
      expect(row.candidate_id).toBe(result.candidates[i].target_id)
      expect(row.strength).toBe(result.candidates[i].strength)
      // Internal score is never invented from the qualitative band.
      expect(row.internal_score).toBeNull()
      // No reason is dressed up as a confidence percentage.
      row.reasons.forEach((r) => expect(looksLikePercentage(r)).toBe(false))
    })
  })

  it("defaults the extraction link to null for metadata-only candidates", () => {
    const result = rankEvidenceCandidates(
      { practice_id: "prac_a", location_hint: "Sterilization" },
      { inventoryItems: [], locations: [{ id: "loc_9", name: "Sterilization Room" }], supplierProducts: [], canonicalProducts: [] }
    )

    const rows = toMatchCandidateRecords(
      { evidence_document_id: "evdoc_2", practice_id: "prac_a" },
      result
    )

    expect(rows.length).toBeGreaterThan(0)
    rows.forEach((row) => expect(row.evidence_extraction_id).toBeNull())
  })

  it("yields no rows when the ranker found nothing to propose", () => {
    const result = rankEvidenceCandidates(
      { practice_id: "prac_a" },
      { inventoryItems: [], locations: [], supplierProducts: [], canonicalProducts: [] }
    )

    expect(result.status).toBe("needs_manual_review")
    expect(toMatchCandidateRecords(context, result)).toEqual([])
  })
})
