import { titleOverlapConfidence } from "./parse"
import type { CanonicalProductInput } from "./search"

export type CanonicalRecord = {
  id: string
  name: string
  category?: string
  unit_of_measure?: string
}

/** One query phrase per line; `#` comments and blank lines ignored. */
export function readSeedQueries(content: string): string[] {
  return content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))
}

// Tokens too generic to anchor on: nearly every canonical name contains them, so
// they create false matches ("Lidocaine carpules dental" -> "Matted Dental Art").
const ANCHOR_STOPWORDS = /\b(?:dental|disposable)\b/gi

/**
 * Pick the canonical product a seed query best corresponds to, scored by how
 * many (non-generic) seed tokens the canonical name covers. Ties break toward
 * the more specific (shorter) name.
 */
export function bestCanonicalAnchor(
  seed: string,
  canonical: CanonicalRecord[]
): { product: CanonicalRecord; score: number } | undefined {
  const scoringSeed = seed.replace(ANCHOR_STOPWORDS, " ")
  let best: { product: CanonicalRecord; score: number } | undefined

  for (const product of canonical) {
    const score = titleOverlapConfidence(product.name, scoringSeed)
    if (
      !best ||
      score > best.score ||
      (score === best.score && product.name.length < best.product.name.length)
    ) {
      best = { product, score }
    }
  }

  return best
}

export type SeedResolution = {
  seed: string
  score: number
  anchor?: CanonicalRecord
  /** The search item, present only when the best anchor met the threshold. */
  item?: CanonicalProductInput
}

/**
 * Resolve each seed query to a search item: the seed is the query (`name`)
 * attached to its best canonical anchor (`id`/`category`). Seeds whose best
 * anchor scores below `anchorMin` are returned without an `item` (skipped).
 */
export function resolveSeeds(
  seeds: string[],
  canonical: CanonicalRecord[],
  anchorMin: number
): SeedResolution[] {
  return seeds.map((seed) => {
    const best = bestCanonicalAnchor(seed, canonical)
    const score = best?.score ?? 0

    if (!best || score < anchorMin) {
      return { seed, score }
    }

    return {
      seed,
      score,
      anchor: best.product,
      item: {
        id: best.product.id,
        name: seed,
        category: best.product.category,
        unit_of_measure: best.product.unit_of_measure,
      },
    }
  })
}
