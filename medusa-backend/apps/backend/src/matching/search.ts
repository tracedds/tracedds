import { tokenizeName } from "./normalize"

// Text ranking for the live search box. Pulled out of the search route so the
// hot/typeahead behaviour can be unit-tested in isolation. The DB already
// narrows candidates with an ILIKE substring match; this reranks them so word
// order, partial words, and minor typos still surface the right product.

// Character trigrams over a normalized string, padded so word boundaries
// contribute ("  glo " -> "  g", " gl", "glo", "lo ").
export function trigrams(value: string): Set<string> {
  const padded = `  ${value} `
  const grams = new Set<string>()
  for (let i = 0; i < padded.length - 2; i++) {
    grams.add(padded.slice(i, i + 3))
  }
  return grams
}

export function dice(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0
  let shared = 0
  for (const gram of a) {
    if (b.has(gram)) shared += 1
  }
  return (2 * shared) / (a.size + b.size)
}

// Fraction of query tokens that match a name token by prefix. This is what makes
// the box behave like a hot/typeahead search: a partially typed word ("glo")
// counts as a hit on "gloves" instead of waiting for the whole word. We measure
// recall over the query (not symmetric Jaccard) so a longer, more descriptive
// product name isn't penalized for its extra words.
export function tokenPrefixRecall(queryTokens: string[], nameTokens: string[]): number {
  if (!queryTokens.length) return 0
  let matched = 0
  for (const queryToken of queryTokens) {
    if (nameTokens.some((nameToken) => nameToken.startsWith(queryToken))) {
      matched += 1
    }
  }
  return matched / queryTokens.length
}

// Prefix-aware token overlap + character trigram similarity, so reordered words,
// partially typed words, and minor typos still rank ("glo" ~ "Nitrile Gloves").
export function nameSimilarity(queryTokens: string[], queryGrams: Set<string>, name: string): number {
  const nameTokens = tokenizeName(name)
  const tokenSim = tokenPrefixRecall(queryTokens, nameTokens)
  const charSim = dice(queryGrams, trigrams(nameTokens.join(" ")))
  return 0.5 * tokenSim + 0.5 * charSim
}
