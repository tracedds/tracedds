import { Client } from "pg"
import { refreshMatchIndex } from "../matching/match-index"
import { resolveDatabaseUrl } from "../utils/database-url"
import { assertDestructiveDbOperationAllowed } from "../utils/db-safety"

/**
 * Rebuild only the invoice-matching blocking read-model
 * (medmkp_supplier_product_match_index) without touching the price/category
 * materialized views — those use REFRESH ... CONCURRENTLY which can stall on the
 * hosted DB. Use this after ingestion when only the match index needs to catch
 * up, and to populate the table the first time. Ensures the table exists so it
 * can run before the migration has been applied.
 *
 * Writes (TRUNCATE + reinsert), so a remote DATABASE_URL requires
 * ALLOW_REMOTE_DB_DESTRUCTIVE=true.
 */
async function main() {
  assertDestructiveDbOperationAllowed("refresh-match-index")

  const databaseUrl = resolveDatabaseUrl()

  const client = new Client({
    connectionString: databaseUrl,
    ssl: /localhost|127\.0\.0\.1/.test(databaseUrl) ? undefined : { rejectUnauthorized: false },
  })

  await client.connect()
  try {
    await client.query(
      `create table if not exists "medmkp_supplier_product_match_index" ("supplier_product_id" text not null, "supplier_id" text not null, "norm_sku" text not null default '', "norm_mfr_sku" text not null default '', "code_tokens" text[] not null default '{}', "core_tokens" text[] not null default '{}', constraint "medmkp_supplier_product_match_index_pkey" primary key ("supplier_product_id"));`
    )
    await client.query(`create index if not exists "IDX_medmkp_spmi_supplier_norm_sku" on "medmkp_supplier_product_match_index" ("supplier_id", "norm_sku");`)
    await client.query(`create index if not exists "IDX_medmkp_spmi_norm_mfr_sku" on "medmkp_supplier_product_match_index" ("norm_mfr_sku");`)
    await client.query(`create index if not exists "IDX_medmkp_spmi_code_tokens" on "medmkp_supplier_product_match_index" using gin ("code_tokens");`)
    await client.query(`create index if not exists "IDX_medmkp_spmi_core_tokens" on "medmkp_supplier_product_match_index" using gin ("core_tokens");`)

    const started = Date.now()
    const indexed = await refreshMatchIndex(client)
    console.log(`Refreshed match index: ${indexed} products in ${Date.now() - started} ms`)
  } finally {
    await client.end()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
