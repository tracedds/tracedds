import { decodeBody } from "../charset"

// In Windows-1252, ™ is byte 0x99 and ® is byte 0xAE. Those bytes are invalid
// as standalone UTF-8, which is exactly why a UTF-8 decode mangles them to
// U+FFFD. "Kerr™" => 0x4B 0x65 0x72 0x72 0x99.
const cp1252Kerr = Buffer.from([0x4b, 0x65, 0x72, 0x72, 0x99])
const utf8Kerr = Buffer.from("Kerr™", "utf-8")

describe("decodeBody", () => {
  it("decodes well-formed UTF-8 named in the header", () => {
    expect(decodeBody(utf8Kerr, "text/html; charset=utf-8")).toBe("Kerr™")
  })

  it("decodes Windows-1252 declared in the header", () => {
    expect(decodeBody(cp1252Kerr, "text/html; charset=windows-1252")).toBe("Kerr™")
  })

  it("decodes Windows-1252 declared via legacy aliases", () => {
    expect(decodeBody(cp1252Kerr, "text/html; charset=ISO-8859-1")).toBe("Kerr™")
  })

  it("recovers Windows-1252 bytes mislabeled as UTF-8 (no replacement char)", () => {
    const out = decodeBody(cp1252Kerr, "text/html; charset=utf-8")
    expect(out).toBe("Kerr™")
    expect(out).not.toContain("�")
  })

  it("recovers Windows-1252 bytes when no charset is declared anywhere", () => {
    expect(decodeBody(cp1252Kerr, null)).toBe("Kerr™")
  })

  it("honors a <meta charset> when the header omits it", () => {
    const html = Buffer.concat([
      Buffer.from('<html><head><meta charset="windows-1252"></head><body>', "latin1"),
      cp1252Kerr,
      Buffer.from("</body></html>", "latin1"),
    ])
    expect(decodeBody(html, "text/html")).toContain("Kerr™")
  })

  it("does not corrupt valid UTF-8 multibyte content", () => {
    const cafe = Buffer.from("Crème café", "utf-8")
    expect(decodeBody(cafe, "text/html; charset=utf-8")).toBe("Crème café")
  })
})
