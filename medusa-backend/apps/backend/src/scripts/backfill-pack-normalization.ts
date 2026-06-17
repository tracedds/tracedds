import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { parsePack } from "../ingestion/pack"
import { assertDestructiveDbOperationAllowed } from "../utils/db-safety"

// Backfills structured pack fields on existing supplier_products and per-unit
// price on existing snapshots. DRY-RUN by default; pass `--commit` to write.
// Writing to a remote DB additionally requires ALLOW_REMOTE_DB_DESTRUCTIVE=true.
//
//   npm run pack:backfill                              # dry-run (no writes)
//   PACK_BACKFILL_COMMIT=true npm run pack:backfill     # write (local)
//   PACK_BACKFILL_COMMIT=true ALLOW_REMOTE_DB_DESTRUCTIVE=true npm run pack:backfill   # write (remote)
export default async function backfillPackNormalization({ container, args }: { container: any; args: string[] }) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const knex = container.resolve(ContainerRegistrationKeys.PG_CONNECTION)
  const commit = process.env.PACK_BACKFILL_COMMIT === "true" || (args || []).includes("--commit")
  const dbUrl = process.env.DATABASE_URL || ""
  const host = (() => { try { return new URL(dbUrl).hostname } catch { return "?" } })()

  logger.info(`Pack backfill: host=${host} mode=${commit ? "COMMIT" : "DRY-RUN"}`)
  if (commit) {
    assertDestructiveDbOperationAllowed("backfill-pack-normalization", dbUrl)
  }

  const batchSize = 2000
  let lastId = ""
  let scanned = 0
  let parsed = 0
  const bySource: Record<string, number> = { pack_size: 0, name: 0, none: 0 }
  const samples: string[] = []

  // Phase A: parse each supplier_product and write the structured pack fields.
  for (;;) {
    const rows: Array<{ id: string; pack_size: string | null; name: string | null; category: string | null }> =
      await knex("medmkp_supplier_product")
        .select("id", "pack_size", "name", "category")
        .where("id", ">", lastId)
        .orderBy("id", "asc")
        .limit(batchSize)

    if (!rows.length) break
    lastId = rows[rows.length - 1].id

    const values: any[] = []
    const tuples: string[] = []
    for (const r of rows) {
      scanned++
      const p = parsePack(r.pack_size, r.name, r.category)
      bySource[p.source] = (bySource[p.source] || 0) + 1
      const has = p.pack_quantity !== null
      if (has) parsed++
      if (has && p.source === "name" && samples.length < 12) {
        samples.push(`  ${p.pack_quantity} ${p.base_unit} [${p.basis}] <- "${(r.name || "").slice(0, 48)}"`)
      }
      // Cast placeholders so Postgres types the VALUES columns correctly
      // (pack_quantity is numeric to allow measure quantities like 1.7 ml).
      tuples.push("(?::text, ?::numeric, ?::text, ?::text, ?::text, ?::int)")
      values.push(
        r.id,
        p.pack_quantity,
        has ? p.base_unit : null,
        has ? p.basis : null,
        p.source,
        has ? Math.round(p.confidence * 100) : null
      )
    }

    if (commit) {
      await knex.raw(
        `UPDATE medmkp_supplier_product AS t SET
           pack_quantity = v.pack_quantity,
           base_unit = v.base_unit,
           pack_basis = v.pack_basis,
           pack_parse_source = v.pack_parse_source,
           pack_parse_confidence = v.pack_parse_confidence
         FROM (VALUES ${tuples.join(",")}) AS v(id, pack_quantity, base_unit, pack_basis, pack_parse_source, pack_parse_confidence)
         WHERE t.id = v.id`,
        values
      )
    }

    if (scanned % 20000 === 0) logger.info(`  ...scanned ${scanned}`)
  }

  const pct = (n: number) => (scanned ? ((100 * n) / scanned).toFixed(1) + "%" : "n/a")
  logger.info(`Phase A: scanned=${scanned} parsed=${parsed} (${pct(parsed)})`)
  logger.info(`  by source: pack_size=${bySource.pack_size} name=${bySource.name} none=${bySource.none}`)
  logger.info(`  sample name-recoveries:\n${samples.join("\n")}`)

  // Phase B: set unit_price_cents on snapshots whose product now has a quantity.
  if (commit) {
    const result: any = await knex.raw(
      `UPDATE medmkp_supplier_price_snapshot s
         SET unit_price_cents = round(s.price_cents::numeric / sp.pack_quantity)
         FROM medmkp_supplier_product sp
         WHERE s.supplier_product_id = sp.id
           AND sp.pack_quantity IS NOT NULL AND sp.pack_quantity > 0
           AND s.price_cents IS NOT NULL`
    )
    logger.info(`Phase B: snapshots updated = ${result.rowCount ?? "(n/a)"}`)
  } else {
    const counts: any = await knex.raw(
      `SELECT
         (SELECT count(*) FROM medmkp_supplier_price_snapshot) AS total,
         (SELECT count(*) FROM medmkp_supplier_price_snapshot s
            WHERE coalesce(s.price_cents,0) > 0) AS priced`
    )
    const row = counts.rows ? counts.rows[0] : counts[0]
    logger.info(`Phase B (dry-run): ${row.priced} priced snapshots of ${row.total} total; unit_price will be set for those whose product parsed (~${pct(parsed)} of products).`)
  }

  logger.info(commit ? "COMMIT complete." : "DRY-RUN complete — no writes made.")
}
