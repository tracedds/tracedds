import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { assertDestructiveDbOperationAllowed } from "../utils/db-safety"

// Soft-deletes duplicate supplier_product rows that share (supplier_id, sku),
// keeping the single best row per group. "Best" prefers, in order: a row that
// has a product image, then a canonical match, then a priced snapshot, then the
// newest, then the lexically-smallest id (deterministic). The loser rows and
// their canonical matches + price snapshots are soft-deleted (deleted_at set).
//
// Duplicates come from (a) a SKU re-listed within one catalog and (b) the same
// SKU ingested under two source_catalogs (e.g. Pearson sitemap vs website). The
// ingestion id fix (supplier-catalog.ts) stops (a) going forward; this script
// cleans up the rows already in the database.
//
// DRY-RUN by default; set CATALOG_DEDUPE_COMMIT=true to write (medusa exec does
// not forward `-- --commit` to the script, so use the env var). A remote DB
// additionally requires ALLOW_REMOTE_DB_DESTRUCTIVE=true.
//
//   npm run catalog:dedupe                                                        # dry-run
//   CATALOG_DEDUPE_COMMIT=true npm run catalog:dedupe                             # write (local)
//   CATALOG_DEDUPE_COMMIT=true ALLOW_REMOTE_DB_DESTRUCTIVE=true npm run catalog:dedupe  # write (remote)
//   DEDUPE_SUPPLIER="Pearson Dental" npm run catalog:dedupe                       # scope to one supplier
export default async function dedupeSupplierProducts({ container, args }: { container: any; args: string[] }) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const knex = container.resolve(ContainerRegistrationKeys.PG_CONNECTION)
  const argv = args || []
  const commit = process.env.CATALOG_DEDUPE_COMMIT === "true" || argv.includes("--commit")
  const supplierArg =
    process.env.DEDUPE_SUPPLIER ||
    (argv.find((arg) => arg.startsWith("--supplier=")) || "").split("=").slice(1).join("=") ||
    null
  const dbUrl = process.env.DATABASE_URL || ""
  const host = (() => {
    try {
      return new URL(dbUrl).hostname
    } catch {
      return "?"
    }
  })()

  logger.info(
    `Catalog dedupe: host=${host} mode=${commit ? "COMMIT" : "DRY-RUN"}${supplierArg ? ` supplier="${supplierArg}"` : ""}`
  )
  if (commit) {
    assertDestructiveDbOperationAllowed("dedupe-supplier-products", dbUrl)
  }

  const supplierFilter = supplierArg
    ? `AND p.supplier_id IN (SELECT id FROM medmkp_supplier WHERE name = ? AND deleted_at IS NULL)`
    : ``
  const bindings = supplierArg ? [supplierArg] : []

  // Rank rows within each (supplier_id, sku) group; rn = 1 is the keeper. The
  // match/price flags are computed once via joins (not correlated subqueries)
  // because medmkp_canonical_product_match has no supplier_product_id index, so
  // a per-row EXISTS would seq-scan it thousands of times.
  const rankedQuery = `
    WITH dups AS (
      SELECT p.supplier_id, p.sku
      FROM medmkp_supplier_product p
      WHERE p.deleted_at IS NULL AND p.sku NOT LIKE 'NO-SKU-%' ${supplierFilter}
      GROUP BY p.supplier_id, p.sku HAVING count(*) > 1
    ),
    candidates AS (
      SELECT p.id, p.supplier_id, p.sku, p.created_at, (p.image_url <> '') AS has_image
      FROM medmkp_supplier_product p
      JOIN dups d ON d.supplier_id = p.supplier_id AND d.sku = p.sku
      WHERE p.deleted_at IS NULL AND p.sku NOT LIKE 'NO-SKU-%'
    ),
    match_flags AS (
      SELECT DISTINCT m.supplier_product_id FROM medmkp_canonical_product_match m
      WHERE m.deleted_at IS NULL AND m.match_status IN ('exact', 'variant')
        AND m.supplier_product_id IN (SELECT id FROM candidates)
    ),
    price_flags AS (
      SELECT DISTINCT s.supplier_product_id FROM medmkp_supplier_price_snapshot s
      WHERE s.deleted_at IS NULL AND s.price_cents > 0
        AND s.supplier_product_id IN (SELECT id FROM candidates)
    ),
    ranked AS (
      SELECT c.id, c.supplier_id, c.has_image,
        (mf.supplier_product_id IS NOT NULL) AS has_match,
        row_number() OVER (
          PARTITION BY c.supplier_id, c.sku
          ORDER BY c.has_image DESC, (mf.supplier_product_id IS NOT NULL) DESC,
                   (pf.supplier_product_id IS NOT NULL) DESC, c.created_at DESC, c.id ASC
        ) AS rn
      FROM candidates c
      LEFT JOIN match_flags mf ON mf.supplier_product_id = c.id
      LEFT JOIN price_flags pf ON pf.supplier_product_id = c.id
    )
    SELECT r.id, sup.name AS supplier, r.rn, r.has_image, r.has_match
    FROM ranked r JOIN medmkp_supplier sup ON sup.id = r.supplier_id`

  // One pass: pull every duplicate-group member, then derive the report and the
  // loser id list in memory (avoids re-running the expensive query three times).
  const rankedRes: any = await knex.raw(rankedQuery, bindings)
  const rows: Array<{ id: string; supplier: string; rn: string | number; has_image: boolean; has_match: boolean }> =
    rankedRes.rows || rankedRes
  const keepers = rows.filter((row) => Number(row.rn) === 1)
  const losers = rows.filter((row) => Number(row.rn) > 1)
  const lossesBySupplier = new Map<string, number>()
  for (const row of losers) {
    lossesBySupplier.set(row.supplier, (lossesBySupplier.get(row.supplier) ?? 0) + 1)
  }

  logger.info(
    `  duplicate groups: ${keepers.length} | rows to soft-delete: ${losers.length} | ` +
      `keepers with image: ${keepers.filter((row) => row.has_image).length} | ` +
      `keepers with match: ${keepers.filter((row) => row.has_match).length}`
  )
  for (const [supplier, count] of [...lossesBySupplier.entries()].sort((a, b) => b[1] - a[1])) {
    logger.info(`    ${supplier}: ${count}`)
  }

  if (!commit) {
    logger.info("DRY-RUN complete — no writes made. Re-run with --commit to soft-delete duplicates.")
    return
  }

  const loserIds = losers.map((row) => row.id)
  logger.info(`Soft-deleting ${loserIds.length} duplicate products (+ their matches & snapshots)...`)

  const chunkSize = 1000
  let done = 0
  for (let i = 0; i < loserIds.length; i += chunkSize) {
    const chunk = loserIds.slice(i, i + chunkSize)
    await knex("medmkp_canonical_product_match")
      .whereIn("supplier_product_id", chunk)
      .whereNull("deleted_at")
      .update({ deleted_at: knex.fn.now() })
    await knex("medmkp_supplier_price_snapshot")
      .whereIn("supplier_product_id", chunk)
      .whereNull("deleted_at")
      .update({ deleted_at: knex.fn.now() })
    await knex("medmkp_supplier_product")
      .whereIn("id", chunk)
      .whereNull("deleted_at")
      .update({ deleted_at: knex.fn.now() })
    done += chunk.length
    logger.info(`  ...soft-deleted ${done}/${loserIds.length}`)
  }
  logger.info("COMMIT complete.")
}
