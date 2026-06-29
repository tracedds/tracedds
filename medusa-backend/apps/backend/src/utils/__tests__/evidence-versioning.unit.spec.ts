import {
  acceptVersion,
  applyStatusUpdate,
  buildVersionDraft,
  deriveCurrentVersion,
  nextVersionNumber,
  type EvidenceVersion,
} from "../evidence-versioning"

// The immutable version chain behind one evidence document: monotonic version
// numbers, a single accepted version (the document's current truth), older
// accepted versions superseded on accept, and a frozen captured snapshot.
describe("evidence document versioning", () => {
  const draftInput = (over: Record<string, any> = {}) => ({
    evidence_document_id: "evdoc_1",
    practice_id: "prac_1",
    file_name: "sds.pdf",
    storage_key: "ev/evdoc_1/v1.pdf",
    extracted_fields: { manufacturer: "3M", revision: "2024-01" },
    source_kind: "upload" as const,
    captured_by: "user_1",
    ...over,
  })

  describe("creating multiple versions for one document", () => {
    it("numbers versions monotonically from 1", () => {
      const v1 = buildVersionDraft(draftInput())
      expect(v1.version_number).toBe(1)
      expect(v1.status).toBe("pending")

      const v2 = buildVersionDraft(
        draftInput({ storage_key: "ev/evdoc_1/v2.pdf" }),
        [v1]
      )
      expect(v2.version_number).toBe(2)

      const v3 = buildVersionDraft(draftInput(), [v1, v2])
      expect(v3.version_number).toBe(3)
    })

    it("nextVersionNumber tolerates gaps and empty history", () => {
      expect(nextVersionNumber([])).toBe(1)
      expect(
        nextVersionNumber([{ version_number: 2 }, { version_number: 5 }])
      ).toBe(6)
    })

    it("defaults captured_at and clears lifecycle fields on a draft", () => {
      const now = new Date("2026-06-29T12:00:00Z")
      const v = buildVersionDraft(draftInput(), [], now)
      expect(v.captured_at).toBe(now)
      expect(v.accepted_at).toBeNull()
      expect(v.superseded_at).toBeNull()
      expect(v.superseded_by_version_id).toBeNull()
    })
  })

  describe("accepting a version", () => {
    const seed = (): EvidenceVersion[] => [
      { ...buildVersionDraft(draftInput()), id: "evver_1" },
      {
        ...buildVersionDraft(draftInput({ storage_key: "v2" }), [
          { version_number: 1 },
        ]),
        id: "evver_2",
      },
    ]

    it("marks the target accepted and points the document at it", () => {
      const now = new Date("2026-06-29T12:00:00Z")
      const { versions, currentVersionId } = acceptVersion(seed(), "evver_2", {
        now,
        actor: "reviewer_1",
      })
      expect(currentVersionId).toBe("evver_2")
      const accepted = versions.find((v) => v.id === "evver_2")!
      expect(accepted.status).toBe("accepted")
      expect(accepted.accepted_at).toBe(now)
      expect(accepted.accepted_by).toBe("reviewer_1")
      // The untouched pending sibling stays pending.
      expect(versions.find((v) => v.id === "evver_1")!.status).toBe("pending")
    })

    it("supersedes the previously accepted version", () => {
      const first = acceptVersion(seed(), "evver_1").versions
      const now = new Date("2026-06-29T13:00:00Z")
      const { versions } = acceptVersion(first, "evver_2", { now })

      const old = versions.find((v) => v.id === "evver_1")!
      expect(old.status).toBe("superseded")
      expect(old.superseded_at).toBe(now)
      expect(old.superseded_by_version_id).toBe("evver_2")

      // Exactly one accepted version remains — the document's current truth.
      expect(versions.filter((v) => v.status === "accepted")).toHaveLength(1)
      expect(deriveCurrentVersion(versions)!.id).toBe("evver_2")
    })

    it("throws for an unknown version id", () => {
      expect(() => acceptVersion(seed(), "evver_nope")).toThrow(/not found/)
    })
  })

  describe("deriveCurrentVersion", () => {
    it("returns null when nothing is accepted yet", () => {
      const versions: EvidenceVersion[] = [
        { ...buildVersionDraft(draftInput()), id: "evver_1" },
      ]
      expect(deriveCurrentVersion(versions)).toBeNull()
    })
  })

  describe("immutability of the captured snapshot", () => {
    const existing = (): EvidenceVersion => ({
      ...buildVersionDraft(draftInput()),
      id: "evver_1",
    })

    it("allows review/status metadata to change", () => {
      const updated = applyStatusUpdate(existing(), {
        status: "rejected",
        rejected_by: "reviewer_1",
        review_note: "wrong product",
      })
      expect(updated.status).toBe("rejected")
      expect(updated.review_note).toBe("wrong product")
    })

    it("rejects edits to a frozen file field", () => {
      expect(() =>
        applyStatusUpdate(existing(), { storage_key: "tampered" } as any)
      ).toThrow(/immutable/)
    })

    it("rejects edits to the extracted-fields snapshot", () => {
      expect(() =>
        applyStatusUpdate(existing(), {
          extracted_fields: { manufacturer: "tampered" },
        } as any)
      ).toThrow(/immutable/)
    })

    it("allows a no-op patch that re-sends an unchanged frozen value", () => {
      const row = existing()
      expect(() =>
        applyStatusUpdate(row, {
          storage_key: row.storage_key,
          extracted_fields: row.extracted_fields,
          status: "accepted",
        } as any)
      ).not.toThrow()
    })
  })
})
