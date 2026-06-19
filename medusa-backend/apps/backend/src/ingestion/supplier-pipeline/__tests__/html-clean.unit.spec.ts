import { decodeHtml, decodeHtmlEntities, normalizeText } from "../html"

describe("decodeHtmlEntities", () => {
  it("decodes the named entities the old decoder already handled", () => {
    expect(decodeHtmlEntities("A &amp; B")).toBe("A & B")
    expect(decodeHtmlEntities("3&quot; tip")).toBe('3" tip')
    expect(decodeHtmlEntities("Dr&#39;s choice")).toBe("Dr's choice")
  })

  it("decodes numeric decimal and hex entities", () => {
    expect(decodeHtmlEntities("Kerr&#8482;")).toBe("Kerr™")
    expect(decodeHtmlEntities("Wands&#xae; Refills")).toBe("Wands® Refills")
    expect(decodeHtmlEntities("don&#8217;t")).toBe("don’t")
  })

  it("decodes common named symbol entities", () => {
    expect(decodeHtmlEntities("Kerr&trade;")).toBe("Kerr™")
    expect(decodeHtmlEntities("Garrison&reg;")).toBe("Garrison®")
    expect(decodeHtmlEntities("XP&sup2;")).toBe("XP²")
  })

  it("leaves unknown entities untouched", () => {
    expect(decodeHtmlEntities("a &bogus; b")).toBe("a &bogus; b")
  })
})

describe("normalizeText", () => {
  it("strips U+FFFD replacement characters", () => {
    expect(normalizeText("Calset� Composite Tray")).toBe("Calset Composite Tray")
  })

  it("folds smart quotes to ASCII", () => {
    expect(normalizeText("“Mega” Dr’s")).toBe('"Mega" Dr\'s')
  })

  it("folds the non-breaking hyphen to a plain hyphen", () => {
    expect(normalizeText("Quik‑Tip")).toBe("Quik-Tip")
  })

  it("folds non-breaking and exotic spaces and collapses whitespace", () => {
    expect(normalizeText("A  B   C")).toBe("A B C")
  })

  it("removes zero-width characters", () => {
    expect(normalizeText("Bur​s")).toBe("Burs")
  })

  it("keeps legitimate symbols and accented letters intact", () => {
    expect(normalizeText("Kerr™ Wands® XP² café")).toBe(
      "Kerr™ Wands® XP² café"
    )
  })
})

describe("decodeHtml (entities + normalization together)", () => {
  it("handles a realistic mangled product name", () => {
    expect(decodeHtml("UNiPACK&#8482; SLDR  PSP Barrier&nbsp;Envelopes")).toBe(
      "UNiPACK™ SLDR PSP Barrier Envelopes"
    )
  })

  it("recovers entity-encoded smart quotes as straight quotes", () => {
    expect(decodeHtml("Great White Shark&#8217;s Gel")).toBe("Great White Shark's Gel")
  })
})
