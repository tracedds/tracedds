// GTIN / UPC barcode normalization for the scanner lookup.
//
// A scanner does not hand back the same width we stored. DC Dental's NetSuite
// `upccode` is 12-digit UPC-A, but a phone (BarcodeDetector API / ZXing) usually
// returns EAN-13 = "0" + UPC-A, and case labels can be GTIN-14 = "00" + UPC-A.
// Leading zeros are pure padding across GTIN-8/12/13/14 — the same number, so a
// scan must match the stored value regardless of the width it arrived in.

// Standard GTIN mod-10 check digit, valid for GTIN-8/12/13/14 (and any 8–14
// digit code, right-aligned). Weights alternate 3,1 starting from the rightmost
// data digit. Catches reader misreads and manual-entry typos before we touch
// the DB.
export function isValidGtin(value: string | number): boolean {
  const digits = String(value ?? "").replace(/\D/g, "")
  if (digits.length < 8 || digits.length > 14) return false
  const body = digits.slice(0, -1)
  const check = Number(digits[digits.length - 1])
  let sum = 0
  for (let i = 0; i < body.length; i++) {
    // Rightmost body digit gets weight 3, then alternate moving left.
    const weight = (body.length - i) % 2 === 1 ? 3 : 1
    sum += Number(body[i]) * weight
  }
  return (10 - (sum % 10)) % 10 === check
}

// Equivalent width-agnostic representations of a scanned code, so an exact-match
// IN lookup against the stored barcode hits whatever width was stored (this
// keeps the partial barcode index usable — no functional/LIKE scan). Returns []
// when the input isn't a plausible GTIN, so callers can short-circuit to "no
// match" without querying.
export function gtinVariants(scanned: string | number): string[] {
  const digits = String(scanned ?? "").replace(/\D/g, "")
  if (!isValidGtin(digits)) return []
  const core = digits.replace(/^0+/, "") || "0" // significant digits, unpadded
  return [...new Set([
    digits,                  // as scanned
    core,                    // zero-stripped
    core.padStart(12, "0"),  // UPC-A  (what DC Dental stored)
    core.padStart(13, "0"),  // EAN-13
    core.padStart(14, "0"),  // GTIN-14
  ])]
}
