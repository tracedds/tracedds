import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { getPostgresPool } from "../../../../utils/postgres"

const CACHE_TTL_MS = 5 * 60 * 1000

type SupplierRow = { id: string; name: string; product_count: string }

let cache: { loadedAt: number; suppliers: { id: string; name: string; product_count: number }[] } | null = null

// Distinct ingested suppliers that have at least one active product. Drives the
// preferred-supplier picker in the buyer's default buying preferences.
async function loadSuppliers() {
  const pool = getPostgresPool()
  const result = await pool.query<SupplierRow>(
    `SELECT s.id, s.name, count(p.id) AS product_count
     FROM medmkp_supplier s
     JOIN medmkp_supplier_product p ON p.supplier_id = s.id AND p.deleted_at IS NULL
     WHERE s.deleted_at IS NULL
     GROUP BY s.id, s.name
     HAVING count(p.id) > 0
     ORDER BY s.name ASC`
  )
  return result.rows.map((row) => ({ id: row.id, name: row.name, product_count: Number(row.product_count) }))
}

export async function GET(_req: MedusaRequest, res: MedusaResponse) {
  if (!cache || Date.now() - cache.loadedAt > CACHE_TTL_MS) {
    cache = { loadedAt: Date.now(), suppliers: await loadSuppliers() }
  }
  res.json({ suppliers: cache.suppliers })
}
