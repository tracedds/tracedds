import { parsePack, unitPriceCents } from "../pack"

describe("parsePack", () => {
  it("parses the dominant N/unit pack_size formats", () => {
    expect(parsePack("5/Pack", "")).toMatchObject({ pack_quantity: 5, basis: "pack", source: "pack_size" })
    expect(parsePack("100/Box", "")).toMatchObject({ pack_quantity: 100, basis: "box" })
    expect(parsePack("10/Pk", "")).toMatchObject({ pack_quantity: 10, basis: "pack" })
    expect(parsePack("200/Box", "")).toMatchObject({ pack_quantity: 200, basis: "box" })
  })

  it("parses 'Word of N' formats", () => {
    expect(parsePack("Pkg of 10", "")).toMatchObject({ pack_quantity: 10, basis: "pack" })
    expect(parsePack("Pkg of 100", "")).toMatchObject({ pack_quantity: 100, basis: "pack" })
    expect(parsePack("box of 200", "")).toMatchObject({ pack_quantity: 200, basis: "box" })
    expect(parsePack("Case of 10", "")).toMatchObject({ pack_quantity: 10, basis: "case" })
  })

  it("multiplies explicit nesting from pack_size (N x M)", () => {
    expect(parsePack("10 x 100", "")).toMatchObject({ pack_quantity: 1000, basis: "case" })
  })

  it("recovers pack quantity from the name when pack_size is empty", () => {
    expect(parsePack("", "Night Angel Black Nitrile Gloves 100/Pk X-Large")).toMatchObject({
      pack_quantity: 100,
      basis: "pack",
      source: "name",
    })
    expect(parsePack(null, "Earloop Procedure Masks 50/Box")).toMatchObject({ pack_quantity: 50, source: "name" })
  })

  it("does NOT treat product dimensions in a name as a pack count", () => {
    // "2x2" is a gauze size, not a pack of 4 — NxM is disabled for names.
    const result = parsePack("", "Gauze Sponges 2x2 8-ply 200/Bag")
    expect(result.pack_quantity).toBe(200) // picks the real 200/Bag, not 4
    expect(result.basis).toBe("pack")
  })

  it("returns null quantity when no pack info is recoverable", () => {
    expect(parsePack("", "Filtek Universal Composite A2")).toMatchObject({
      pack_quantity: null,
      source: "none",
      confidence: 0,
    })
  })

  it("extracts volume/weight measures as the base unit", () => {
    expect(parsePack("", "Composite Restorative Syringe 4g")).toMatchObject({ pack_quantity: 4, base_unit: "g" })
    expect(parsePack("", "Lidocaine 1.7ml Carpule")).toMatchObject({ pack_quantity: 1.7, base_unit: "ml" })
  })

  it("scores pack_size higher confidence than name", () => {
    expect(parsePack("100/Box", "").confidence).toBeGreaterThan(parsePack("", "Gloves 100/Box").confidence)
  })
})

describe("unitPriceCents", () => {
  it("divides price by pack quantity and rounds", () => {
    expect(unitPriceCents(332, 100)).toBe(3) // $3.32 / 100 = $0.033
    expect(unitPriceCents(2695, 200)).toBe(13) // $26.95 / 200 = $0.135 -> 13
  })

  it("returns null when quantity is unknown or invalid", () => {
    expect(unitPriceCents(500, null)).toBeNull()
    expect(unitPriceCents(500, 0)).toBeNull()
  })
})
