import { Client } from "pg"
import { assertDestructiveDbOperationAllowed } from "../utils/db-safety"

/**
 * Borrow GTINs onto supplier products that ship without one, by joining on
 * brand + manufacturer SKU against the GUDID reference (medmkp_gtin_reference,
 * populated by ingest-gudid-gtin-reference.ts).
 *
 * Safe-join rules (a wrong GTIN is worse than none — it makes the scanner
 * confidently return the wrong product):
 *   - exact normalized brand AND model match
 *   - manufacturer_sku is a real MPN (<> sku) of length >= 4
 *   - the (brand_norm, model_norm) key maps to exactly ONE distinct GTIN
 *   - only fills rows that have no barcode, or were previously filled by gudid
 *     (so a re-run refreshes its own rows but never clobbers a supplier upccode)
 *
 * Dry run by default (reports counts + samples). Pass --commit to write, which
 * on a remote DATABASE_URL also needs ALLOW_REMOTE_DB_DESTRUCTIVE=true.
 */

const MIN_MODEL_LEN = 4

// Unambiguous single-GTIN keys from the reference, two ways:
//   unique_keys  — (brand_norm, model_norm) for the general brand+MPN join
//   hs_keys      — model_norm alone for Henry Schein labeled devices (companyName
//                  "HENRY SCHEIN, INC."). GUDID keys HS house-brand products on
//                  the HS item number, which is our sku (== manufacturer_sku),
//                  so the brand+MPN path can't reach them. The HS item number is
//                  globally unique to HS, so company + exact item number is a
//                  safe identity.
const UNIQUE_KEYS_CTE = `
  unique_keys as (
    select brand_norm, model_norm, min(gtin) gtin
    from medmkp_gtin_reference
    group by brand_norm, model_norm
    having count(distinct gtin) = 1
  ),
  hs_keys as (
    select model_norm, min(gtin) gtin
    from medmkp_gtin_reference
    where lower(regexp_replace(company_name, '[^a-z0-9]', '', 'gi')) like 'henryschein%'
    group by model_norm
    having count(distinct gtin) = 1
  )`

// Supplier rows eligible to receive a GUDID GTIN. The general brand+MPN path is
// unioned with the HS item-number path; a product matched by both collapses to a
// single deterministic GTIN (min) so the UPDATE writes each row once.
const CANDIDATES_CTE = `
  candidate_pairs as (
    select sp.id, sp.supplier_id, uk.gtin
    from medmkp_supplier_product sp
    join unique_keys uk
      on uk.brand_norm = lower(regexp_replace(sp.brand, '[^a-z0-9]', '', 'gi'))
     and uk.model_norm = lower(regexp_replace(sp.manufacturer_sku, '[^a-z0-9]', '', 'gi'))
    where sp.deleted_at is null
      and (sp.barcode is null or sp.barcode = '' or sp.barcode_source = 'gudid')
      and sp.manufacturer_sku <> sp.sku
      and length(lower(regexp_replace(sp.manufacturer_sku, '[^a-z0-9]', '', 'gi'))) >= ${MIN_MODEL_LEN}
    union
    select sp.id, sp.supplier_id, hk.gtin
    from medmkp_supplier_product sp
    join hs_keys hk
      on hk.model_norm = lower(regexp_replace(sp.sku, '[^a-z0-9]', '', 'gi'))
    where sp.supplier_id = 'msup_henryschein_com'
      and sp.deleted_at is null
      and (sp.barcode is null or sp.barcode = '' or sp.barcode_source = 'gudid')
      and length(lower(regexp_replace(sp.sku, '[^a-z0-9]', '', 'gi'))) >= ${MIN_MODEL_LEN}
  ),
  candidates as (
    select id, supplier_id, min(gtin) gtin
    from candidate_pairs
    group by id, supplier_id
  )`

async function main() {
  const commit = process.argv.includes("--commit")
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) throw new Error("DATABASE_URL is not set")
  if (commit) assertDestructiveDbOperationAllowed("enrich-barcodes-from-gudid --commit")

  const client = new Client({
    connectionString: databaseUrl,
    ssl: /localhost|127\.0\.0\.1/.test(databaseUrl) ? undefined : { rejectUnauthorized: false },
  })
  await client.connect()

  try {
    const { rows: refCount } = await client.query(`select count(*)::int n from medmkp_gtin_reference`)
    if (refCount[0].n === 0) {
      throw new Error("medmkp_gtin_reference is empty — run ingest-gudid-gtin-reference.ts first")
    }

    const { rows: summary } = await client.query(
      `with ${UNIQUE_KEYS_CTE}, ${CANDIDATES_CTE}
       select supplier_id, count(*)::int matched
       from candidates group by supplier_id order by matched desc`
    )
    const total = summary.reduce((sum, r) => sum + r.matched, 0)
    console.log(`GUDID reference rows: ${refCount[0].n}`)
    console.log(`Supplier products that would get a GTIN: ${total}`)
    console.table(summary)

    const { rows: samples } = await client.query(
      `with ${UNIQUE_KEYS_CTE}, ${CANDIDATES_CTE}
       select sp.supplier_id, sp.brand, sp.manufacturer_sku, c.gtin, left(sp.name, 50) name
       from candidates c join medmkp_supplier_product sp on sp.id = c.id
       limit 15`
    )
    console.log("Samples:")
    console.table(samples)

    if (!commit) {
      console.log("\nDry run (no writes). Re-run with --commit to persist.")
      return
    }

    const result = await client.query(
      `with ${UNIQUE_KEYS_CTE}, ${CANDIDATES_CTE}
       update medmkp_supplier_product sp
       set barcode = c.gtin, barcode_source = 'gudid', updated_at = now()
       from candidates c
       where sp.id = c.id
         and (sp.barcode is distinct from c.gtin or sp.barcode_source is distinct from 'gudid')`
    )
    console.log(`\nCommitted: ${result.rowCount} supplier products updated with GUDID GTINs.`)
  } finally {
    await client.end()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
