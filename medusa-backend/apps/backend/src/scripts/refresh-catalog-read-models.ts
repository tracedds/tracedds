import { Client } from "pg"
import { refreshMatchIndex } from "../matching/match-index"

async function main() {
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not set")
  }

  const client = new Client({
    connectionString: databaseUrl,
    ssl: /localhost|127\.0\.0\.1/.test(databaseUrl) ? undefined : { rejectUnauthorized: false },
  })

  await client.connect()
  try {
    await client.query(`REFRESH MATERIALIZED VIEW CONCURRENTLY medmkp_supplier_current_price`)
    await client.query(`REFRESH MATERIALIZED VIEW CONCURRENTLY medmkp_supplier_category_summary`)
    await client.query(`REFRESH MATERIALIZED VIEW CONCURRENTLY medmkp_supplier_product_current_offer`)
    const indexed = await refreshMatchIndex(client)
    console.log(`Refreshed match index: ${indexed} products`)
  } finally {
    await client.end()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
