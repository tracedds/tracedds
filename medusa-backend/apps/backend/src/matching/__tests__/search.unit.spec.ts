import { tokenizeName } from "../normalize"
import { nameSimilarity, tokenPrefixRecall, trigrams } from "../search"

// Mirror how the search route scores a candidate: build the query tokens and
// trigrams once, then score each product name.
function score(query: string, name: string): number {
  const queryTokens = tokenizeName(query)
  const queryGrams = trigrams(queryTokens.join(" ") || query.toLowerCase())
  return nameSimilarity(queryTokens, queryGrams, name)
}

// The route keeps candidates scoring at or above this.
const THRESHOLD = 0.12

describe("search ranking — hot/prefix matching", () => {
  it("surfaces a product from a partially typed word", () => {
    // The reported bug: "glo" should already find gloves, not wait for "gloves".
    expect(score("glo", "Nitrile Exam Gloves")).toBeGreaterThanOrEqual(THRESHOLD)
    expect(score("glov", "Nitrile Exam Gloves")).toBeGreaterThanOrEqual(THRESHOLD)
    expect(score("nitr", "Nitrile Exam Gloves")).toBeGreaterThanOrEqual(THRESHOLD)
  })

  it("still matches the fully typed word", () => {
    expect(score("gloves", "Nitrile Exam Gloves")).toBeGreaterThanOrEqual(THRESHOLD)
  })

  it("ranks the matching product above an unrelated one for a prefix query", () => {
    expect(score("glo", "Nitrile Exam Gloves")).toBeGreaterThan(
      score("glo", "Composite Resin Syringe")
    )
  })

  it("does not pull in an unrelated product for a prefix query", () => {
    expect(score("glo", "Composite Resin Syringe")).toBeLessThan(THRESHOLD)
  })
})

describe("tokenPrefixRecall", () => {
  it("counts a query token as a hit when a name token starts with it", () => {
    expect(tokenPrefixRecall(["glo"], ["nitrile", "glove"])).toBe(1)
  })

  it("requires every query token to match for a full recall", () => {
    expect(tokenPrefixRecall(["exam", "glo"], ["nitrile", "exam", "glove"])).toBe(1)
    expect(tokenPrefixRecall(["foo", "glo"], ["nitrile", "exam", "glove"])).toBe(0.5)
  })

  it("does not match a token that only appears mid-word", () => {
    // "loo" is inside "igloo" but not a prefix, so it earns no token credit.
    expect(tokenPrefixRecall(["loo"], ["igloo", "cooler"])).toBe(0)
  })

  it("is empty for an empty query", () => {
    expect(tokenPrefixRecall([], ["nitrile", "glove"])).toBe(0)
  })
})
