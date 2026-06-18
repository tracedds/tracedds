import { gtinVariants, isValidGtin } from "../gtin"

// A real, check-digit-valid UPC-A and its wider GTIN representations (the same
// number with leading-zero padding). DC Dental stores the 12-digit UPC-A.
const UPC_A = "036000291452"
const EAN_13 = "0036000291452" // "0" + UPC-A, as a phone reader often returns
const GTIN_14 = "00036000291452" // "00" + UPC-A, as a case label carries

describe("isValidGtin", () => {
  it("accepts valid GTIN-8/12/13/14", () => {
    expect(isValidGtin("96385074")).toBe(true) // EAN-8
    expect(isValidGtin(UPC_A)).toBe(true)
    expect(isValidGtin(EAN_13)).toBe(true)
    expect(isValidGtin(GTIN_14)).toBe(true)
  })

  it("rejects a wrong check digit", () => {
    expect(isValidGtin("036000291453")).toBe(false)
  })

  it("rejects implausible lengths and non-digits", () => {
    expect(isValidGtin("1234567")).toBe(false) // too short
    expect(isValidGtin("012345678901234")).toBe(false) // 15 digits, too long
    expect(isValidGtin("not-a-barcode")).toBe(false)
    expect(isValidGtin("")).toBe(false)
  })
})

describe("gtinVariants", () => {
  // The key guarantee: whatever width the reader returns, the candidate list
  // includes the stored UPC-A, so the exact-match lookup resolves to the same
  // supplier product (and thus the same canonical product).
  it("EAN-13 and GTIN-14 forms both yield the stored 12-digit UPC-A", () => {
    expect(gtinVariants(UPC_A)).toContain(UPC_A)
    expect(gtinVariants(EAN_13)).toContain(UPC_A)
    expect(gtinVariants(GTIN_14)).toContain(UPC_A)
  })

  it("raw and EAN-13 forms share a lookup candidate (resolve identically)", () => {
    const fromUpcA = new Set(gtinVariants(UPC_A))
    const shared = gtinVariants(EAN_13).filter((v) => fromUpcA.has(v))
    expect(shared).toContain(UPC_A)
  })

  it("includes the as-scanned form and the zero-stripped core", () => {
    const variants = gtinVariants(EAN_13)
    expect(variants).toContain(EAN_13) // as scanned
    expect(variants).toContain("36000291452") // zero-stripped core
  })

  it("strips non-digit separators before matching", () => {
    expect(gtinVariants("0 36000 29145 2")).toContain(UPC_A)
  })

  it("returns [] for a non-GTIN or misread (caller short-circuits to 'none')", () => {
    expect(gtinVariants("12345")).toEqual([]) // too short
    expect(gtinVariants("036000291453")).toEqual([]) // bad check digit
    expect(gtinVariants("abcdefgh")).toEqual([]) // non-numeric
    expect(gtinVariants("")).toEqual([])
  })
})
