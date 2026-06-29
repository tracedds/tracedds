import {
  rankEvidenceCandidates,
  generateEvidenceCandidates,
  medmkpEvidenceCandidateSource,
  type EvidenceCandidatePools,
  type EvidenceSignal,
  type EvidenceCandidateMedmkp,
} from "../evidence-candidates"

function pools(partial: Partial<EvidenceCandidatePools> = {}): EvidenceCandidatePools {
  return {
    inventoryItems: [],
    locations: [],
    supplierProducts: [],
    canonicalProducts: [],
    ...partial,
  }
}

function signal(partial: Partial<EvidenceSignal> = {}): EvidenceSignal {
  return { practice_id: "prac_a", ...partial }
}

// Every user-facing string in a result must be a plain label — never a
// percentage or numeric confidence. This walks the whole result.
function userFacingStrings(result: unknown): string[] {
  const out: string[] = []
  const visit = (value: unknown) => {
    if (typeof value === "string") out.push(value)
    else if (Array.isArray(value)) value.forEach(visit)
    else if (value && typeof value === "object") Object.values(value).forEach(visit)
  }
  visit(result)
  return out
}

describe("evidence candidate ranking — SKU / product", () => {
  it("ranks a supplier product and promotes its catalog product on an exact alphanumeric SKU", () => {
    const result = rankEvidenceCandidates(
      signal({ sku: "DCG30UNI", product_name: "Composite Resin Syringe" }),
      pools({
        supplierProducts: [
          {
            id: "msp_1",
            supplier_id: "msup_a",
            sku: "DCG30UNI",
            name: "Composite Resin Syringe A2",
            canonical_product_id: "mcp_1",
          },
        ],
        canonicalProducts: [{ id: "mcp_1", name: "Composite Resin Syringe" }],
      })
    )

    expect(result.status).toBe("ok")
    const supplier = result.candidates.find((c) => c.target_type === "supplier_product")
    expect(supplier).toBeDefined()
    expect(supplier!.strength).toBe("strong")
    expect(supplier!.reasons).toContain("Catalog SKU matches the code on the document")

    const canonical = result.candidates.find((c) => c.target_type === "canonical_product")
    expect(canonical).toBeDefined()
    expect(canonical!.target_id).toBe("mcp_1")
  })

  it("treats a lone short numeric SKU as weak — collision-prone, needs manual review", () => {
    const result = rankEvidenceCandidates(
      signal({ sku: "0044" }),
      pools({
        supplierProducts: [{ id: "msp_x", supplier_id: "msup_a", sku: "0044", name: "Some Item" }],
      })
    )

    expect(result.status).toBe("needs_manual_review")
    expect(result.candidates.every((c) => c.strength === "weak")).toBe(true)
  })

  it("a weak numeric SKU corroborated by a strong name match becomes confident", () => {
    const result = rankEvidenceCandidates(
      signal({ sku: "0044", product_name: "Nitrile Exam Gloves Medium" }),
      pools({
        supplierProducts: [
          { id: "msp_y", supplier_id: "msup_a", sku: "0044", name: "Nitrile Exam Gloves Medium" },
        ],
      })
    )

    expect(result.status).toBe("ok")
    const sp = result.candidates.find((c) => c.target_type === "supplier_product")!
    expect(sp.strength === "possible" || sp.strength === "strong").toBe(true)
    expect(sp.reasons.length).toBeGreaterThanOrEqual(2)
  })

  it("matches a manufacturer SKU carried in the supplier's manufacturer_sku field", () => {
    const result = rankEvidenceCandidates(
      signal({ manufacturer_sku: "ER24XL" }),
      pools({
        supplierProducts: [
          { id: "msp_m", supplier_id: "msup_a", sku: "219-ER24XL", manufacturer_sku: "ER24XL", name: "Root Canal Sealer" },
        ],
      })
    )
    const sp = result.candidates.find((c) => c.target_type === "supplier_product")!
    expect(sp.reasons.some((r) => r.includes("Manufacturer SKU"))).toBe(true)
  })
})

describe("evidence candidate ranking — barcode", () => {
  it("matches a supplier product and an inventory item on the same GTIN despite leading-zero width", () => {
    const result = rankEvidenceCandidates(
      // Same item, two stored widths: UPC-A vs GTIN-14 ("00"-padded).
      signal({ barcode: "00036000291452" }),
      pools({
        supplierProducts: [{ id: "msp_b", supplier_id: "msup_a", barcode: "036000291452", name: "Barrier Film" }],
        inventoryItems: [
          { id: "inv_b", location_id: "loc_1", name: "Barrier Film", barcode: "0036000291452" },
        ],
      })
    )
    const sp = result.candidates.find((c) => c.target_type === "supplier_product")!
    const inv = result.candidates.find((c) => c.target_type === "inventory_item")!
    expect(sp.strength).toBe("strong")
    expect(inv.strength).toBe("strong")
    expect(inv.reasons).toContain("Barcode matches this shelf item")
  })
})

describe("evidence candidate ranking — location", () => {
  it("names a location directly from a location hint", () => {
    const result = rankEvidenceCandidates(
      signal({ location_hint: "Sterilization" }),
      pools({
        locations: [
          { id: "loc_st", name: "Sterilization", type: "sterilization" },
          { id: "loc_op", name: "Operatory 1", type: "operatory" },
        ],
      })
    )
    const locs = result.candidates.filter((c) => c.target_type === "location")
    expect(locs).toHaveLength(1)
    expect(locs[0].target_id).toBe("loc_st")
    expect(locs[0].reasons).toContain("Evidence names this location")
  })

  it("surfaces the location holding a matched shelf item", () => {
    const result = rankEvidenceCandidates(
      signal({ lot_number: "LOT-7788", expiration_date: "2027-03-01" }),
      pools({
        inventoryItems: [
          {
            id: "inv_l",
            location_id: "loc_cab",
            name: "Lidocaine Carpules",
            lot_number: "LOT 7788",
            expiration_date: "2027-03-01",
          },
        ],
        locations: [{ id: "loc_cab", name: "Hygiene Cabinet", type: "cabinet" }],
      })
    )
    const loc = result.candidates.find((c) => c.target_type === "location")
    expect(loc).toBeDefined()
    expect(loc!.target_id).toBe("loc_cab")
    expect(loc!.reasons.some((r) => r.includes("Holds"))).toBe(true)
  })
})

describe("evidence candidate ranking — lot / expiry", () => {
  it("combines lot and expiry on the same shelf item into a confident candidate", () => {
    const result = rankEvidenceCandidates(
      signal({ lot_number: "AB12CD", expiration_date: "2026-12-31" }),
      pools({
        inventoryItems: [
          {
            id: "inv_le",
            location_id: "loc_1",
            name: "Composite Capsules",
            lot_number: "ab12cd",
            expiration_date: new Date("2026-12-31T00:00:00Z"),
          },
          // Same lot text but different expiry — only one signal, stays weaker.
          {
            id: "inv_other",
            location_id: "loc_1",
            name: "Other Capsules",
            lot_number: "ab12cd",
            expiration_date: "2030-01-01",
          },
        ],
      })
    )
    const best = result.candidates.find((c) => c.target_id === "inv_le")!
    const other = result.candidates.find((c) => c.target_id === "inv_other")!
    expect(best.reasons).toContain("Lot number matches this shelf item")
    expect(best.reasons).toContain("Expiration date matches this shelf item")
    expect(STRENGTH(best)).toBeGreaterThan(STRENGTH(other))
  })
})

const STRENGTH = (c: { strength: string }) => ({ strong: 3, possible: 2, weak: 1 }[c.strength] ?? 0)

describe("evidence candidate ranking — no match / no signal", () => {
  it("returns needs_manual_review with a reason when nothing matches", () => {
    const result = rankEvidenceCandidates(
      signal({ sku: "ZZZZZZ", product_name: "Unrelated Mystery Item" }),
      pools({
        supplierProducts: [{ id: "msp_z", supplier_id: "msup_a", sku: "AAA111", name: "Dental Mirror" }],
      })
    )
    expect(result.status).toBe("needs_manual_review")
    expect(result.candidates).toHaveLength(0)
    expect(result.manual_review_reason).toBeTruthy()
  })

  it("returns a no-metadata manual-review reason when the signal is empty", () => {
    const result = rankEvidenceCandidates(signal({}), pools())
    expect(result.status).toBe("needs_manual_review")
    expect(result.manual_review_reason).toMatch(/no identifying metadata/i)
  })
})

describe("no user-facing confidence percentages", () => {
  it("never emits a percentage or numeric-confidence string in any field", () => {
    const result = rankEvidenceCandidates(
      signal({
        sku: "DCG30UNI",
        barcode: "00036000291452",
        product_name: "Composite Resin Syringe",
        lot_number: "AB12CD",
        expiration_date: "2026-12-31",
        location_hint: "Sterilization",
      }),
      pools({
        supplierProducts: [
          { id: "msp_1", supplier_id: "msup_a", sku: "DCG30UNI", name: "Composite Resin Syringe", canonical_product_id: "mcp_1", barcode: "036000291452" },
        ],
        canonicalProducts: [{ id: "mcp_1", name: "Composite Resin Syringe" }],
        inventoryItems: [
          { id: "inv_1", location_id: "loc_st", name: "Composite Resin Syringe", lot_number: "ab12cd", expiration_date: "2026-12-31" },
        ],
        locations: [{ id: "loc_st", name: "Sterilization", type: "sterilization" }],
      })
    )

    expect(result.candidates.length).toBeGreaterThan(0)
    for (const text of userFacingStrings(result)) {
      expect(text).not.toMatch(/%/)
      expect(text).not.toMatch(/\bconfidence\b/i)
      expect(text).not.toMatch(/\b\d+\s*(?:percent|pct)\b/i)
      expect(text).not.toMatch(/\b\d+\s*\/\s*100\b/)
    }
    // Strength is qualitative, never numeric.
    for (const candidate of result.candidates) {
      expect(["strong", "possible", "weak"]).toContain(candidate.strength)
    }
  })
})

describe("practice scoping prevents cross-practice leakage", () => {
  // A fake medmkp service holding two practices' data. Only practice A's
  // locations/inventory should ever be read for practice A's evidence.
  function fakeMedmkp(): EvidenceCandidateMedmkp {
    const locations = [
      { id: "loc_a1", practice_id: "prac_a", name: "Operatory 1", type: "operatory" },
      { id: "loc_b1", practice_id: "prac_b", name: "Operatory 1", type: "operatory" },
    ]
    const inventory = [
      { id: "inv_a", location_id: "loc_a1", name: "Practice A Gloves", lot_number: "L1" },
      { id: "inv_b", location_id: "loc_b1", name: "Practice B Gloves", lot_number: "L1" },
    ]
    return {
      async listLocations(filter) {
        return locations.filter((l) => l.practice_id === filter.practice_id).map(({ id, name, type }) => ({ id, name, type }))
      },
      async listInventoryItems(filter) {
        const ids = new Set(filter.location_id)
        return inventory.filter((i) => ids.has(i.location_id))
      },
      async listSupplierProducts() {
        return []
      },
      async listCanonicalProductMatches() {
        return []
      },
      async listCanonicalProducts() {
        return []
      },
    }
  }

  it("only reads the evidence practice's own inventory and locations", async () => {
    const source = medmkpEvidenceCandidateSource(fakeMedmkp())
    const inventory = await source.practiceInventory("prac_a")
    const locations = await source.practiceLocations("prac_a")

    expect(inventory.map((i) => i.id)).toEqual(["inv_a"])
    expect(locations.map((l) => l.id)).toEqual(["loc_a1"])
  })

  it("end-to-end, a lot match resolves only within the practice", async () => {
    const source = medmkpEvidenceCandidateSource(fakeMedmkp())
    const result = await generateEvidenceCandidates(
      signal({ practice_id: "prac_a", lot_number: "L1", product_name: "Practice A Gloves" }),
      source
    )
    const inv = result.candidates.filter((c) => c.target_type === "inventory_item")
    expect(inv.every((c) => c.target_id === "inv_a")).toBe(true)
    expect(inv.some((c) => c.target_id === "inv_b")).toBe(false)
  })
})

describe("medmkp source catalog resolution", () => {
  it("attaches the resolved canonical product to a SKU-matched supplier listing", async () => {
    const medmkp: EvidenceCandidateMedmkp = {
      async listLocations() {
        return []
      },
      async listInventoryItems() {
        return []
      },
      async listSupplierProducts(filter) {
        if ("sku" in filter) {
          return [{ id: "msp_s", supplier_id: "msup_a", sku: "DCG30UNI", name: "Resin Syringe" }]
        }
        return []
      },
      async listCanonicalProductMatches() {
        return [{ supplier_product_id: "msp_s", canonical_product_id: "mcp_s", match_status: "exact" }]
      },
      async listCanonicalProducts(filter) {
        return filter.id.includes("mcp_s") ? [{ id: "mcp_s", name: "Resin Syringe" }] : []
      },
    }
    const source = medmkpEvidenceCandidateSource(medmkp)
    const { supplierProducts, canonicalProducts } = await source.catalogCandidates(
      signal({ sku: "DCG30UNI" })
    )
    expect(supplierProducts[0].canonical_product_id).toBe("mcp_s")
    expect(canonicalProducts.map((c) => c.id)).toContain("mcp_s")
  })
})
