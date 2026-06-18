import type { Client } from "pg"
import { batchInsert } from "./db"
import { normalizeProduct, normalizeSku } from "./normalize"
import type { SupplierProductRow } from "./types"

/**
 * Denormalized blocking read-model for invoice line-item matching.
 *
 * The match endpoint used to load the whole catalog into memory per request to
 * build inverted indexes. Instead we persist the same blocking keys that
 * `normalizeProduct` computes — normalized SKUs and name/code token arrays — so
 * candidate retrieval becomes a few indexed SQL lookups. Scoring still runs in
 * JS on the retrieved rows, unchanged. See line-items.ts for the query side.
 */

/**
 * Core tokens shared by more than this many products are too common to be
 * discriminating; the old matcher skipped them at query time. We drop them from
 * the stored core_tokens instead, which reproduces that skip exactly — a
 * dropped token simply matches nothing through the && array overlap.
 */
export const CORE_TOKEN_MAX_DF = 600

type ProductRow = {
  id: string
  supplier_id: string
  sku: string
  manufacturer_sku: string
  brand: string
  name: string
  pack_size: string
}

type MatchIndexRow = {
  supplier_product_id: string
  supplier_id: string
  norm_sku: string
  norm_mfr_sku: string
  code_tokens: string[]
  core_tokens: string[]
}

const MATCH_INDEX_COLUMNS = [
  "supplier_product_id",
  "supplier_id",
  "norm_sku",
  "norm_mfr_sku",
  "code_tokens",
  "core_tokens",
]

/**
 * Rebuild `medmkp_supplier_product_match_index` from the live catalog. Reads
 * every active supplier product, derives its blocking keys, and fully rewrites
 * the table in one transaction. Run after ingestion / catalog refresh.
 * Returns the number of indexed products.
 */
export async function refreshMatchIndex(client: Client): Promise<number> {
  const { rows } = await client.query<ProductRow>(
    `SELECT id, supplier_id, sku, manufacturer_sku, brand, name, pack_size
     FROM medmkp_supplier_product
     WHERE deleted_at IS NULL`
  )

  const indexRows: MatchIndexRow[] = []
  const coreTokenDf = new Map<string, number>()

  for (const row of rows) {
    const product = normalizeProduct(toSupplierProductRow(row))

    // code_tokens: the manufacturer SKU (when it carries identity weight) plus
    // catalog-number-looking tokens found in the name. Mirrors how the old
    // in-memory `byCode` map was built.
    const codeTokens = new Set<string>()
    if (product.mfrSku.length >= 4 && product.skuStrength > 0.1) {
      codeTokens.add(product.mfrSku)
    }
    for (const token of product.skuLikeTokens) {
      if (token !== product.mfrSku) {
        codeTokens.add(token)
      }
    }

    const coreTokens = [...new Set(product.coreTokens)]
    for (const token of coreTokens) {
      coreTokenDf.set(token, (coreTokenDf.get(token) ?? 0) + 1)
    }

    indexRows.push({
      supplier_product_id: row.id,
      supplier_id: row.supplier_id,
      norm_sku: normalizeSku(row.sku),
      norm_mfr_sku: product.mfrSku,
      code_tokens: [...codeTokens],
      core_tokens: coreTokens,
    })
  }

  // Bake in the document-frequency cap now that global counts are known.
  for (const indexRow of indexRows) {
    indexRow.core_tokens = indexRow.core_tokens.filter(
      (token) => (coreTokenDf.get(token) ?? 0) <= CORE_TOKEN_MAX_DF
    )
  }

  await client.query("BEGIN")
  try {
    await client.query(`TRUNCATE TABLE medmkp_supplier_product_match_index`)
    await batchInsert(
      client,
      "medmkp_supplier_product_match_index",
      MATCH_INDEX_COLUMNS,
      indexRows.map((row) => [
        row.supplier_product_id,
        row.supplier_id,
        row.norm_sku,
        row.norm_mfr_sku,
        row.code_tokens,
        row.core_tokens,
      ])
    )
    await client.query("COMMIT")
  } catch (error) {
    await client.query("ROLLBACK")
    throw error
  }

  return indexRows.length
}

/** Tokenization only needs a subset of columns; fill the rest so the row
 * satisfies `normalizeProduct`'s SupplierProductRow input. */
function toSupplierProductRow(row: ProductRow): SupplierProductRow {
  return {
    id: row.id,
    supplier_id: row.supplier_id,
    sku: row.sku,
    manufacturer_sku: row.manufacturer_sku,
    brand: row.brand,
    name: row.name,
    category: "",
    pack_size: row.pack_size,
    unit_of_measure: "",
    product_url: "",
    image_url: "",
    price_cents: null,
    price_basis: null,
  }
}
