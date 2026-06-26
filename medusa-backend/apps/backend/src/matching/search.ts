import {
  tokenizeName,
  COLOR_WORDS,
  NAME_STOP_TOKENS,
  PACK_UNIT_WORDS,
  MEASURE_UNIT_SUFFIX,
} from "./normalize"

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

const COLOR_SET = new Set(COLOR_WORDS)
const PACK_UNIT_SET = new Set(PACK_UNIT_WORDS.split("|"))

// A trailing token that describes pack / size / count / color rather than the
// product itself. Stripped when locating the head noun.
function isDescriptorToken(token: string): boolean {
  return (
    /^[0-9]+(\.[0-9]+)?$/.test(token) ||
    MEASURE_UNIT_SUFFIX.test(token.toUpperCase()) ||
    PACK_UNIT_SET.has(token) ||
    COLOR_SET.has(token) ||
    NAME_STOP_TOKENS.has(token)
  )
}

// The product's head noun: the last real word once trailing size / pack / color
// / count descriptors are dropped. Dental names put the product type last
// ("Patient Bibs", "Tray Covers", "Bib Clips"), so this is what the shopper is
// really after. Returns "" if every token is a descriptor.
export function headNoun(nameTokens: string[]): string {
  for (let i = nameTokens.length - 1; i >= 0; i--) {
    if (!isDescriptorToken(nameTokens[i])) return nameTokens[i]
  }
  return ""
}

// Bonus added when the query is (a prefix of) the product's head noun. Sized to
// clear the trigram-brevity edge that otherwise lets a shorter accessory name
// outrank the product itself, while staying small enough not to reorder genuine
// full matches.
const HEAD_NOUN_BONUS = 0.25

// Prefix-aware token overlap + character trigram similarity, so reordered words,
// partially typed words, and minor typos still rank ("glo" ~ "Nitrile Gloves").
// Plus a head-noun boost so the typed word matching the product TYPE ("bib" ->
// "Patient Bibs") outranks the same word used as a modifier ("bib" -> "Bib
// Clips", whose head noun is "clip"). The boost is additive: it only promotes a
// real type match, never demotes a result, so the prefix/typo behaviour above is
// untouched for everything else.
export function nameSimilarity(queryTokens: string[], queryGrams: Set<string>, name: string): number {
  const nameTokens = tokenizeName(name)
  const tokenSim = tokenPrefixRecall(queryTokens, nameTokens)
  const charSim = dice(queryGrams, trigrams(nameTokens.join(" ")))
  const base = 0.5 * tokenSim + 0.5 * charSim
  const head = headNoun(nameTokens)
  const headMatch = head !== "" && queryTokens.some((token) => head.startsWith(token))
  return Math.min(1, base + (headMatch ? HEAD_NOUN_BONUS : 0))
}
