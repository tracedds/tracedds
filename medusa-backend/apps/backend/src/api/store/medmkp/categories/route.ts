import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { getPostgresPool } from "../../../../utils/postgres"

const CATEGORY_LIMIT = 12
const CATEGORY_CACHE_TTL_MS = 60 * 1000

type CategoryRow = {
  category: string
  product_count: string
  supplier_count: string
}

type BestValueRow = {
  category: string
  name: string
  sku: string
  supplier_id: string
  supplier_name: string | null
  price_cents: number
}

type CategoriesResponse = {
  categories: {
    id: string
    name: string
    product_count: number
    supplier_count: number
    best_value_item: {
      name: string
      sku: string
      supplier_name: string
      unit_price_cents: number
    } | null
  }[]
}

let categoriesCache: { loadedAt: number; response: CategoriesResponse } | null = null
let categoriesPromise: Promise<CategoriesResponse> | null = null

async function loadCategories(): Promise<CategoriesResponse> {
  const pool = getPostgresPool()

  const categories = await pool.query<CategoryRow>(
    `SELECT category, product_count, supplier_count
     FROM medmkp_supplier_category_summary
     ORDER BY product_count DESC
     LIMIT $1`,
    [CATEGORY_LIMIT]
  )

  const bestValue = await pool.query<BestValueRow>(
    `SELECT DISTINCT ON (p.category)
            p.category, p.name, p.sku, p.supplier_id, sup.name AS supplier_name,
            p.price_cents
     FROM medmkp_supplier_product_current_offer p
     LEFT JOIN medmkp_supplier sup ON sup.id = p.supplier_id AND sup.deleted_at IS NULL
     WHERE p.category = ANY($1)
     ORDER BY p.category, p.price_cents ASC`,
    [categories.rows.map((row) => row.category)]
  )
  const bestByCategory = new Map(bestValue.rows.map((row) => [row.category, row]))

  return {
    categories: categories.rows.map((row) => {
      const best = bestByCategory.get(row.category)
      return {
        id: row.category.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
        name: row.category,
        product_count: Number(row.product_count),
        supplier_count: Number(row.supplier_count),
        best_value_item: best
          ? {
              name: best.name,
              sku: best.sku,
              supplier_name: best.supplier_name ?? "Unknown supplier",
              unit_price_cents: best.price_cents,
            }
          : null,
      }
    }),
  }
}

async function getCategories(): Promise<CategoriesResponse> {
  if (categoriesCache && Date.now() - categoriesCache.loadedAt < CATEGORY_CACHE_TTL_MS) {
    return categoriesCache.response
  }

  if (!categoriesPromise) {
    categoriesPromise = loadCategories()
  }

  try {
    const response = await categoriesPromise
    categoriesCache = { loadedAt: Date.now(), response }
    return response
  } finally {
    categoriesPromise = null
  }
}

/**
 * Buyer-facing reorder categories derived from the ingested supplier
 * catalog: the most-stocked categories, each with its cheapest currently
 * priced product as the best-value offer.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    res.json(await getCategories())
  } catch (error) {
    if (error instanceof Error && error.message === "DATABASE_URL is not set") {
      res.status(500).json({ error: error.message })
      return
    }

    throw error
  }
}
