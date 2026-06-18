import {
  bestCanonicalAnchor,
  readSeedQueries,
  resolveSeeds,
  type CanonicalRecord,
} from "../seeds"

const canonical: CanonicalRecord[] = [
  { id: "mcp_gloves_lg", name: "Nitrile Exam Gloves - Large", category: "PPE" },
  { id: "mcp_art_fish", name: "Matted Dental Art Fish", category: "Decor" },
  { id: "mcp_lido", name: "Lidocaine Topical Ointment Mint 50g", category: "Anesthetic" },
  { id: "mcp_gutta", name: "Gutta Percha Points 120/Pk #15", category: "Endo" },
]

describe("readSeedQueries", () => {
  it("keeps query lines and drops comments/blanks", () => {
    expect(
      readSeedQueries("# header\n\nNitrile exam gloves\n  Gutta percha points  \n# trailing")
    ).toEqual(["Nitrile exam gloves", "Gutta percha points"])
  })
})

describe("bestCanonicalAnchor", () => {
  it("matches a seed to the canonical product with the most token overlap", () => {
    const best = bestCanonicalAnchor("Nitrile exam gloves", canonical)
    expect(best?.product.id).toBe("mcp_gloves_lg")
    expect(best?.score).toBe(100)
  })

  it("ignores the generic 'dental' token so it can't anchor a junk match", () => {
    // Without the stopword strip, "dental" would match "Matted Dental Art Fish".
    const best = bestCanonicalAnchor("Lidocaine carpules dental", canonical)
    expect(best?.product.id).toBe("mcp_lido")
  })
})

describe("resolveSeeds", () => {
  it("produces a search item (seed as query, anchor as canonical) above threshold", () => {
    const [resolution] = resolveSeeds(["Gutta percha points"], canonical, 30)
    expect(resolution.item).toMatchObject({
      id: "mcp_gutta",
      name: "Gutta percha points", // the seed is the marketplace query
      category: "Endo",
    })
  })

  it("skips a seed whose best anchor is below the threshold", () => {
    const [resolution] = resolveSeeds(["Completely unrelated widget xyz"], canonical, 30)
    expect(resolution.item).toBeUndefined()
    expect(resolution.score).toBeLessThan(30)
  })
})
